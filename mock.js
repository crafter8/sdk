import {
  HOST_API_V1,
  createAppContext,
  createCrafter8Client,
  createModuleContext,
} from "./index.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function sortedUniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((entry) => String(entry || "").trim()).filter(Boolean))).sort();
}

function asHostApiLabel(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return { hostApi: value, hostApiLabel: `${value}.0.0` };
  }
  const raw = String(value || "").trim();
  if (!raw) {
    return { hostApi: HOST_API_V1, hostApiLabel: `${HOST_API_V1}.0.0` };
  }
  const match = raw.match(/^(\d+)/);
  return {
    hostApi: match ? Number(match[1]) : HOST_API_V1,
    hostApiLabel: raw,
  };
}

function normalizeMockSession(session = {}) {
  const hostApi = asHostApiLabel(session.hostApi ?? session.hostApiLabel ?? HOST_API_V1);
  return Object.freeze({
    authenticated: Boolean(session.authenticated ?? session.userId),
    userId: normalizeString(session.userId),
    userDisplayName: normalizeString(session.userDisplayName ?? session.displayName),
    activeWorkspaceId: normalizeString(session.activeWorkspaceId),
    activeWorkspaceName: normalizeString(session.activeWorkspaceName),
    capabilities: sortedUniqueStrings(session.capabilities),
    hostApi: hostApi.hostApi,
    hostApiLabel: hostApi.hostApiLabel,
  });
}

function matchesQuery(value, query) {
  if (!query) {
    return true;
  }
  const haystack = [
    value?.packageName,
    value?.slug,
    value?.id,
    value?.name,
    value?.description,
    value?.summary,
  ]
    .filter((entry) => typeof entry === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function artifactMatchesSelector(artifact, selector = {}) {
  if (selector.kind && artifact.kind !== selector.kind) return false;
  if (selector.trustLevel && String(artifact.trustLevel || "") !== String(selector.trustLevel)) return false;
  if (selector.packageName && String(artifact.packageName || "") !== String(selector.packageName)) return false;
  if (selector.slug && String(artifact.slug || "") !== String(selector.slug)) return false;
  if (selector.id && String(artifact.id || "") !== String(selector.id)) return false;
  if (selector.user && String(artifact.user || "") !== String(selector.user)) return false;
  if (selector.query && !matchesQuery(artifact, String(selector.query))) return false;
  return true;
}

function guessContentType(value) {
  if (typeof value === "string") {
    return "text/plain";
  }
  return "application/json";
}

function deriveDatapackContents(contentValues = {}) {
  return Object.entries(contentValues)
    .map(([key, value]) => {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) return null;
      return {
        key: normalizedKey,
        label: normalizedKey,
        kind: "file",
        path: `${normalizedKey}.json`,
        contentType: guessContentType(value),
        role: normalizedKey === "manifest" ? "dataset-manifest" : "content",
      };
    })
    .filter(Boolean);
}

function buildInlineDatapackContent(slug, definition, value) {
  const rawText = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const parsed = typeof value === "string" ? null : value;
  return {
    ...definition,
    sizeBytes: Buffer.byteLength(rawText, "utf8"),
    readPolicy: {
      maxInlineBytes: 256 * 1024,
      textLike: true,
      inlineAllowed: true,
      tooLarge: false,
    },
    encoding: "utf8",
    parsed,
    text: parsed === null ? rawText : null,
    sourceKind: "published",
    deliveryKind: "inline",
    url: `/api/datapacks/${encodeURIComponent(slug)}/content?key=${encodeURIComponent(definition.key)}`,
    cacheKey: `${slug}:${definition.key}:mock`,
    requiresAuth: false,
    warnings: [],
  };
}

function normalizeMockDatapack(record) {
  if (!isPlainObject(record)) {
    throw new TypeError("mock datapack record must be an object.");
  }

  const packageName = normalizeString(record.packageName);
  const slug = normalizeString(record.slug) ?? (packageName ? packageName.split("/").pop() : null);
  const id = normalizeString(record.id) ?? packageName ?? slug;
  assertString(id, "mock datapack id");
  assertString(slug, "mock datapack slug");
  const version = normalizeString(record.version) ?? "0.1.0";
  const contentValues = isPlainObject(record.contentValues) ? { ...record.contentValues } : {};
  const contents = Array.isArray(record.contents) && record.contents.length > 0 ? record.contents.map((entry) => ({ ...entry })) : deriveDatapackContents(contentValues);
  const manifest =
    isPlainObject(record.manifest)
      ? { ...record.manifest }
      : {
          name: normalizeString(record.name) ?? slug,
          version,
          profile: normalizeString(record.profile) ?? null,
          contentKeys: contents.map((entry) => entry.key),
        };

  const publicEntry = Object.freeze({
    kind: "datapack",
    packageName,
    id,
    slug,
    version,
    name: normalizeString(record.name) ?? slug,
    description: normalizeString(record.description ?? record.summary) ?? "",
    capability: normalizeString(record.capability) ?? "datapacks.read",
    contentKeys: contents.map((entry) => entry.key),
    artifactRef: packageName ? `datapack:${packageName}` : `datapack:${slug}`,
  });

  const contentsByKey = new Map();
  for (const entry of contents) {
    const key = String(entry.key || "").trim();
    if (!key) continue;
    const value = Object.prototype.hasOwnProperty.call(contentValues, key) ? contentValues[key] : null;
    contentsByKey.set(
      key,
      Object.freeze({
        definition: Object.freeze({
          key,
          label: normalizeString(entry.label) ?? key,
          kind: entry.kind === "dir" ? "dir" : "file",
          path: normalizeString(entry.path) ?? `${key}.json`,
          role: normalizeString(entry.role),
          contentType: normalizeString(entry.contentType) ?? guessContentType(value),
        }),
        value,
      }),
    );
  }

  return Object.freeze({
    publicEntry,
    manifest: Object.freeze(manifest),
    contents: Object.freeze(contents.map((entry) => Object.freeze({ ...entry }))),
    contentValues: Object.freeze({ ...contentValues }),
    contentsByKey,
  });
}

function normalizeOperationRecord(record) {
  if (!isPlainObject(record)) {
    throw new TypeError("mock operation record must be an object.");
  }
  const operation = isPlainObject(record.operation) ? { ...record.operation } : { ...record };
  const operationId = normalizeString(operation.id);
  const path = normalizeString(operation.path) ?? `/api/mock/operations/${encodeURIComponent(operationId || "operation")}`;
  return Object.freeze({
    kind: normalizeString(record.kind ?? operation.kind) ?? "module",
    scope: normalizeString(record.scope ?? operation.scope) ?? "public",
    selectors: isPlainObject(record.selectors) ? { ...record.selectors } : {},
    artifactRef: normalizeString(record.artifactRef),
    artifact: isPlainObject(record.artifact) ? { ...record.artifact } : null,
    operation: Object.freeze({
      id: operationId ?? "operation",
      method: normalizeString(operation.method)?.toUpperCase() ?? "POST",
      surface: normalizeString(operation.surface) ?? "mock",
      scope: normalizeString(operation.scope ?? record.scope) ?? "public",
      capability: normalizeString(operation.capability),
      description: normalizeString(operation.description) ?? "",
      path,
      pathTemplate: normalizeString(operation.pathTemplate),
      pathParams: Array.isArray(operation.pathParams) ? operation.pathParams.slice() : [],
      query: Array.isArray(operation.query) ? operation.query.slice() : [],
      body: operation.body ?? null,
      result: operation.result ?? null,
      execution: operation.execution ?? null,
      examples: operation.examples ?? null,
    }),
    invoke: typeof record.invoke === "function" ? record.invoke : async () => record.result ?? operation.result ?? null,
  });
}

function parseMockRoutePath(inputPath) {
  const url = new URL(inputPath, "https://mock.crafter8.local");
  return {
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
  };
}

function buildArtifactsOperationsResponse(records, selector = {}) {
  const filtered = records.filter((entry) => artifactMatchesSelector({ ...entry.selectors, kind: entry.kind, ...entry.artifact }, selector));
  if (selector.packageName || selector.slug || selector.id || selector.user) {
    const first = filtered[0] || null;
    if (!first) {
      return { data: { resolved: null, catalog: [] } };
    }
    return {
      data: {
        resolved: {
          kind: first.kind,
          scope: first.scope,
          selectors: first.selectors,
          resolvedUser: normalizeString(selector.user),
          artifactRef: first.artifactRef,
          artifact: first.artifact,
          operations: filtered
            .filter((entry) => !selector.operationId || String(entry.operation.id) === String(selector.operationId))
            .map((entry) => entry.operation),
        },
      },
    };
  }

  const groups = new Map();
  for (const record of filtered) {
    const groupKey = `${record.kind}:${record.scope}`;
    const group = groups.get(groupKey) || {
      kind: record.kind,
      scope: record.scope,
      selectors: record.selectors,
      operations: [],
    };
    if (!selector.operationId || String(record.operation.id) === String(selector.operationId)) {
      group.operations.push(record.operation);
    }
    groups.set(groupKey, group);
  }
  return {
    data: {
      catalog: Array.from(groups.values()),
    },
  };
}

export function createMockCrafter8Transport(options = {}) {
  const session = normalizeMockSession(options.session);
  const explicitArtifacts = Object.freeze(
    (Array.isArray(options.artifacts) ? options.artifacts : []).map((entry) => Object.freeze({ ...entry })),
  );
  const datapacks = Object.freeze(
    (Array.isArray(options.datapacks) ? options.datapacks : []).map((entry) => normalizeMockDatapack(entry)),
  );
  const artifacts = Object.freeze([...explicitArtifacts, ...datapacks.map((entry) => entry.publicEntry)]);
  const operations = Object.freeze(
    (Array.isArray(options.operations) ? options.operations : []).map((entry) => normalizeOperationRecord(entry)),
  );

  const datapackBySlug = new Map(datapacks.map((entry) => [entry.publicEntry.slug, entry]));
  const invokeByRoute = new Map(
    operations.map((entry) => [`${entry.operation.method} ${entry.operation.path}`, entry]),
  );

  return Object.freeze({
    async request(request) {
      const method = String(request?.method || "GET").toUpperCase();
      const parsed = parseMockRoutePath(request?.path || "/");
      const query = { ...parsed.query, ...(isPlainObject(request?.query) ? request.query : {}) };

      if (method === "GET" && parsed.path === "/api/session/v1") {
        return { data: { session } };
      }

      if (method === "GET" && parsed.path === "/api/artifacts") {
        const rows = artifacts.filter((entry) => artifactMatchesSelector(entry, query));
        return { data: { artifacts: rows } };
      }

      if (method === "GET" && parsed.path === "/api/artifacts/operations") {
        return buildArtifactsOperationsResponse(operations, query);
      }

      if (method === "GET" && parsed.path === "/api/datapacks") {
        return { data: { datapacks: datapacks.map((entry) => entry.publicEntry) } };
      }

      const datapackMatch = parsed.path.match(/^\/api\/datapacks\/([^/]+)\/([^/]+)$/);
      if (method === "GET" && datapackMatch) {
        const slug = decodeURIComponent(datapackMatch[1]);
        const action = decodeURIComponent(datapackMatch[2]);
        const datapack = datapackBySlug.get(slug);
        if (!datapack) {
          throw new Error(`Mock datapack not found: ${slug}`);
        }

        if (action === "manifest") {
          return { data: { datapack: datapack.publicEntry, manifest: datapack.manifest } };
        }

        if (action === "contents") {
          return { data: { datapack: datapack.publicEntry, dataset: null, contents: datapack.contents } };
        }

        if (action === "resolve-content" || action === "content") {
          const key = normalizeString(query.key);
          if (!key) {
            throw new Error("Mock datapack content key is required.");
          }
          const content = datapack.contentsByKey.get(key);
          if (!content) {
            throw new Error(`Mock datapack content not found: ${slug}/${key}`);
          }
          const resolved = buildInlineDatapackContent(slug, content.definition, content.value);
          return { data: { datapack: datapack.publicEntry, content: resolved } };
        }
      }

      const invokeEntry = invokeByRoute.get(`${method} ${parsed.path}`);
      if (invokeEntry) {
        const result = await invokeEntry.invoke({
          method,
          path: parsed.path,
          query,
          body: request?.body,
          headers: request?.headers ?? {},
          selector: invokeEntry.selectors,
          artifact: invokeEntry.artifact,
          operation: invokeEntry.operation,
        });
        return { data: result };
      }

      throw new Error(`Unsupported mock Crafter8 route: ${method} ${parsed.path}`);
    },
  });
}

export function createMockCrafter8Client(options = {}) {
  return createCrafter8Client({
    transport: createMockCrafter8Transport(options),
    datapacks: options.datapacksOptions ?? { mode: "local-first" },
  });
}

export function createMockCrafter8HostServices(options = {}) {
  const events = [];
  const navigate = typeof options.navigate === "function" ? options.navigate : (path) => path;
  const openItemInGraph =
    typeof options.openItemInGraph === "function" ? options.openItemInGraph : (itemId) => itemId;

  const host = {
    navigation: {
      navigate(path) {
        assertString(path, "navigation path");
        events.push({ type: "navigate", path: path.trim() });
        return navigate(path.trim());
      },
      openItemInGraph(itemId) {
        assertString(itemId, "itemId");
        events.push({ type: "openItemInGraph", itemId: itemId.trim() });
        return openItemInGraph(itemId.trim());
      },
    },
    events,
  };

  return Object.freeze(host);
}

function createDefaultContainer() {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    return document.createElement("div");
  }
  return { nodeType: 1 };
}

export function createMockAppContext(options = {}) {
  const client = options.client ?? createMockCrafter8Client(options);
  const hostServices = options.hostServices ?? options.host ?? createMockCrafter8HostServices(options.hostOptions);
  const artifact = {
    kind: "app",
    id: options.artifact?.id ?? "mock.app",
    version: options.artifact?.version ?? "0.1.0",
    name: options.artifact?.name,
    summary: options.artifact?.summary,
    capabilities: options.artifact?.capabilities,
    dependencies: options.artifact?.dependencies,
    uses: options.artifact?.uses,
    provides: options.artifact?.provides,
  };

  return createAppContext({
    container: options.container ?? createDefaultContainer(),
    client,
    hostServices,
    artifact,
  });
}

export function createMockModuleContext(options = {}) {
  const client = options.client ?? createMockCrafter8Client(options);
  const artifact = {
    kind: "module",
    id: options.artifact?.id ?? "mock.module",
    version: options.artifact?.version ?? "0.1.0",
    name: options.artifact?.name,
    summary: options.artifact?.summary,
    capabilities: options.artifact?.capabilities,
    dependencies: options.artifact?.dependencies,
    uses: options.artifact?.uses,
    provides: options.artifact?.provides,
  };

  return createModuleContext({
    client,
    artifact,
  });
}

export function createMockCrafter8Environment(options = {}) {
  const client = options.client ?? createMockCrafter8Client(options);
  const host = options.hostServices ?? options.host ?? createMockCrafter8HostServices(options.hostOptions);
  const appContext = createMockAppContext({
    ...options,
    client,
    hostServices: host,
  });
  return Object.freeze({
    client,
    host,
    appContext,
  });
}
