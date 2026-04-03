const DEFINITION_SYMBOL = Symbol.for("@crafter8/sdk/definition");
const REGISTERED_DATAPACK_PACKAGE_SOURCES = new Map();

export const ARTIFACT_SPEC_V1 = 1;
export const ARTIFACT_SPEC_V2 = 2;
export const HOST_API_V1 = 1;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function assertOptionalString(value, name) {
  if (value === undefined) {
    return;
  }
  assertString(value, name);
}

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function.`);
  }
}

function isPackageLikeId(value) {
  return typeof value === "string" && value.trim().includes("/");
}

function assertStringArray(value, name) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new TypeError(`${name} must be an array of non-empty strings.`);
  }
}

function copyStringArray(value) {
  return Array.from(new Set(value.map((entry) => entry.trim())));
}

function normalizeUses(uses) {
  if (uses === undefined) {
    return { modules: [], datapacks: [] };
  }

  if (!isPlainObject(uses)) {
    throw new TypeError("uses must be an object.");
  }

  const normalized = {
    modules: [],
    datapacks: [],
  };

  if (uses.modules !== undefined) {
    if (!Array.isArray(uses.modules)) {
      throw new TypeError("uses.modules must be an array.");
    }
    normalized.modules = uses.modules.map((entry) => readArtifactRef(entry, "module").id);
  }

  if (uses.datapacks !== undefined) {
    if (!Array.isArray(uses.datapacks)) {
      throw new TypeError("uses.datapacks must be an array.");
    }
    normalized.datapacks = uses.datapacks.map((entry) => readArtifactRef(entry, "datapack").id);
  }

  return normalized;
}

function normalizeModuleProvides(input) {
  if (input === undefined) {
    return { exports: {}, operations: [] };
  }

  let exportsRecord = {};
  let operations = [];

  if (isPlainObject(input.exports) || isPlainObject(input.provides?.exports)) {
    exportsRecord = isPlainObject(input.exports) ? input.exports : input.provides.exports;
  }

  if (input.operations !== undefined) {
    operations = input.operations;
  } else if (input.provides?.operations !== undefined) {
    operations = input.provides.operations;
  }

  if (!isPlainObject(exportsRecord)) {
    throw new TypeError("module exports must be an object.");
  }

  for (const [key, value] of Object.entries(exportsRecord)) {
    assertString(key, "module export key");
    assertFunction(value, `module export "${key}"`);
  }

  if (operations.length > 0) {
    assertStringArray(operations, "module operations");
  }

  return {
    exports: { ...exportsRecord },
    operations: copyStringArray(operations),
  };
}

function normalizeDatapackProvides(provides) {
  if (provides === undefined) {
    return {};
  }

  if (!isPlainObject(provides)) {
    throw new TypeError("datapack provides must be an object.");
  }

  if (provides.profile !== undefined) {
    assertString(provides.profile, "datapack provides.profile");
  }

  return {
    ...(provides.profile ? { profile: provides.profile.trim() } : {}),
  };
}

function normalizeContents(contents) {
  if (!isPlainObject(contents)) {
    throw new TypeError("contents must be an object.");
  }

  if (contents.root !== undefined) {
    assertString(contents.root, "contents.root");
  }

  if (contents.manifest !== undefined) {
    assertString(contents.manifest, "contents.manifest");
  }

  return {
    ...(contents.root ? { root: contents.root.trim() } : {}),
    ...(contents.manifest ? { manifest: contents.manifest.trim() } : {}),
  };
}

function normalizeDefinition(kind, config) {
  if (!isPlainObject(config)) {
    throw new TypeError(`${kind} definition must be an object.`);
  }

  assertString(config.id, `${kind}.id`);
  assertString(config.name, `${kind}.name`);
  assertOptionalString(config.summary, `${kind}.summary`);

  const normalized = {
    id: config.id.trim(),
    kind,
    name: config.name.trim(),
    summary: config.summary?.trim(),
  };

  if (kind === "app") {
    const hasMount = config.mount !== undefined;
    const hasComponent = config.component !== undefined;
    if (!hasMount && !hasComponent) {
      throw new TypeError("app definition requires either app.mount or app.component.");
    }
    if (hasMount && hasComponent) {
      throw new TypeError("app definition must provide either app.mount or app.component, not both.");
    }
    if (hasMount) {
      assertFunction(config.mount, "app.mount");
      normalized.mount = config.mount;
    }
    if (hasComponent) {
      assertFunction(config.component, "app.component");
      normalized.component = config.component;
    }
    normalized.capabilities = config.capabilities === undefined ? [] : copyStringArray((assertStringArray(config.capabilities, "app.capabilities"), config.capabilities));
    normalized.uses = normalizeUses(config.uses);
  }

  if (kind === "module") {
    normalized.capabilities = config.capabilities === undefined ? [] : copyStringArray((assertStringArray(config.capabilities, "module.capabilities"), config.capabilities));
    normalized.uses = normalizeUses(config.uses);
    normalized.provides = normalizeModuleProvides(config);
  }

  if (kind === "datapack") {
    normalized.contents = normalizeContents(config.contents);
    normalized.provides = normalizeDatapackProvides(config.provides);
  }

  const definition = {
    ...normalized,
    [DEFINITION_SYMBOL]: true,
  };

  return Object.freeze(definition);
}

export function defineApp(config) {
  return normalizeDefinition("app", config);
}

export function defineModule(config) {
  return normalizeDefinition("module", config);
}

export function defineDatapack(config) {
  return normalizeDefinition("datapack", config);
}

function normalizeArtifactRef(kind, value) {
  if (typeof value === "string") {
    assertString(value, `${kind} ref`);
    const id = value.trim();
    return Object.freeze({
      kind,
      id,
      ...(isPackageLikeId(id) ? { packageName: id } : { slug: id }),
    });
  }

  if (isArtifactDefinition(value)) {
    if (value.kind !== kind) {
      throw new TypeError(`Expected ${kind} definition but received ${value.kind}.`);
    }
    return Object.freeze({
      kind,
      id: value.id,
      ...(isPackageLikeId(value.id) ? { packageName: value.id } : { slug: value.id }),
    });
  }

  if (isPlainObject(value)) {
    const rawId = value.id ?? value.packageName ?? value.slug;
    assertString(rawId, `${kind} ref.id`);
    if (value.kind !== undefined && value.kind !== kind) {
      throw new TypeError(`Expected ${kind} ref but received ${value.kind}.`);
    }
    const id = rawId.trim();
    const packageName =
      typeof value.packageName === "string" && value.packageName.trim() !== ""
        ? value.packageName.trim()
        : isPackageLikeId(id)
          ? id
          : undefined;
    const slug =
      typeof value.slug === "string" && value.slug.trim() !== ""
        ? value.slug.trim()
        : !packageName
          ? id
          : undefined;
    const version =
      typeof value.version === "string" && value.version.trim() !== ""
        ? value.version.trim()
        : undefined;
    return Object.freeze({
      kind,
      id,
      ...(packageName ? { packageName } : {}),
      ...(slug ? { slug } : {}),
      ...(version ? { version } : {}),
    });
  }

  throw new TypeError(`${kind} ref must be a string, ref object, or Crafter8 definition.`);
}

export function createAppRef(value) {
  return normalizeArtifactRef("app", value);
}

export function createModuleRef(value) {
  return normalizeArtifactRef("module", value);
}

export function createDatapackRef(value) {
  return normalizeArtifactRef("datapack", value);
}

export function registerDatapackPackageSource(value, source) {
  const datapack = normalizeDatapackSelector(value);
  assertObject(source, "datapack package source");
  const key = datapack.packageName ?? datapack.id;
  if (!key) {
    throw new TypeError("datapack package source requires a packageName or id.");
  }
  const local =
    source.local === undefined || source.local === null
      ? null
      : typeof source.local === "function"
        ? source.local
        : () => source.local;
  const fallback =
    source.fallback === undefined || source.fallback === null
      ? local
      : typeof source.fallback === "function"
        ? source.fallback
        : () => source.fallback;

  if (local !== null) {
    assertFunction(local, "datapack package source.local");
  }
  if (fallback !== null) {
    assertFunction(fallback, "datapack package source.fallback");
  }

  const registered = Object.freeze({
    datapack,
    local,
    fallback,
  });
  REGISTERED_DATAPACK_PACKAGE_SOURCES.set(key, registered);
  if (datapack.id && datapack.id !== key) {
    REGISTERED_DATAPACK_PACKAGE_SOURCES.set(datapack.id, registered);
  }
  if (datapack.slug && datapack.slug !== key) {
    REGISTERED_DATAPACK_PACKAGE_SOURCES.set(datapack.slug, registered);
  }
  return registered;
}

export function getRegisteredDatapackPackageSource(value) {
  const datapack = normalizeDatapackSelector(value);
  const keys = [datapack.packageName, datapack.id, datapack.slug].filter(
    (entry) => typeof entry === "string" && entry.trim() !== "",
  );
  for (const key of keys) {
    const registered = REGISTERED_DATAPACK_PACKAGE_SOURCES.get(key);
    if (registered) {
      return registered;
    }
  }
  return null;
}

export function isArtifactDefinition(value) {
  return Boolean(value?.[DEFINITION_SYMBOL]);
}

export function readArtifactRef(value, expectedKind) {
  const ref = normalizeArtifactRef(expectedKind ?? value?.kind, value);
  if (expectedKind && ref.kind !== expectedKind) {
    throw new TypeError(`Expected ${expectedKind} ref but received ${ref.kind}.`);
  }
  return ref;
}

function normalizeClientSessionSnapshot(session) {
  const source = session && typeof session === "object" ? session : {};
  const version = parseHostApiLabel(source.hostApi ?? source.hostApiLabel ?? source.hostApiVersion ?? HOST_API_V1);
  const grantedCapabilities = Array.isArray(source.grantedCapabilities)
    ? source.grantedCapabilities
    : Array.isArray(source.capabilities)
      ? source.capabilities
      : [];
  return Object.freeze({
    authenticated: Boolean(source.authenticated ?? source.userId),
    userId: typeof source.userId === "string" && source.userId.trim() !== "" ? source.userId.trim() : null,
    userDisplayName:
      typeof source.userDisplayName === "string" && source.userDisplayName.trim() !== ""
        ? source.userDisplayName.trim()
        : typeof source.displayName === "string" && source.displayName.trim() !== ""
          ? source.displayName.trim()
        : null,
    activeWorkspaceId:
      typeof source.activeWorkspaceId === "string" && source.activeWorkspaceId.trim() !== ""
        ? source.activeWorkspaceId.trim()
        : null,
    activeWorkspaceName:
      typeof source.activeWorkspaceName === "string" && source.activeWorkspaceName.trim() !== ""
        ? source.activeWorkspaceName.trim()
        : null,
    capabilities: Array.isArray(grantedCapabilities)
      ? copyStringArray(grantedCapabilities.filter((entry) => typeof entry === "string"))
      : [],
    hostApi: version.hostApi,
    hostApiLabel: version.hostApiLabel,
  });
}

function normalizeDatapackWarnings(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === "string" && entry.trim() !== "")
      .map((entry) => entry.trim());
  }
  if (typeof value === "string" && value.trim() !== "") {
    return [value.trim()];
  }
  throw new TypeError("datapack warnings must be a string or string array.");
}

function normalizeDatapackSelector(value) {
  const ref = readArtifactRef(value, "datapack");
  return Object.freeze({
    kind: "datapack",
    id: ref.id,
    ...(typeof ref.packageName === "string" && ref.packageName.trim() !== "" ? { packageName: ref.packageName.trim() } : {}),
    ...(typeof ref.slug === "string" && ref.slug.trim() !== "" ? { slug: ref.slug.trim() } : {}),
    ...(typeof ref.version === "string" && ref.version.trim() !== "" ? { version: ref.version.trim() } : {}),
  });
}

function normalizeDatapackResolverOptions(options) {
  if (options === undefined) {
    return Object.freeze({
      mode: "remote-first",
      localResolver: null,
      fallbackResolver: null,
    });
  }

  assertObject(options, "datapack client options");
  const mode =
    options.mode === undefined
      ? "remote-first"
      : options.mode === "local-first" || options.mode === "remote-first"
        ? options.mode
        : null;
  if (!mode) {
    throw new TypeError('datapack client mode must be "local-first" or "remote-first".');
  }

  const localResolver =
    options.localResolver === undefined || options.localResolver === null ? null : options.localResolver;
  const fallbackResolver =
    options.fallbackResolver === undefined || options.fallbackResolver === null ? null : options.fallbackResolver;

  if (localResolver !== null) {
    assertFunction(localResolver, "datapack localResolver");
  }
  if (fallbackResolver !== null) {
    assertFunction(fallbackResolver, "datapack fallbackResolver");
  }

  return Object.freeze({
    mode,
    localResolver,
    fallbackResolver,
  });
}

function buildPublishedDatapackContentPath(slug, key) {
  const params = new URLSearchParams();
  params.set("key", key);
  return `/api/datapacks/${encodeURIComponent(slug)}/content?${params.toString()}`;
}

function normalizeResolvedDatapackContent(sourceKind, datapack, key, response, warningList = []) {
  const normalizedDatapack = normalizeDatapackSelector(datapack);
  const normalizedKey = String(key || "").trim();
  const data = response?.data ?? response ?? {};
  const content = data?.content ?? {};
  const resolvedDatapack = Object.freeze({
    ...normalizedDatapack,
    ...(typeof data?.datapack?.packageName === "string" && data.datapack.packageName.trim() !== ""
      ? { packageName: data.datapack.packageName.trim() }
      : {}),
    ...(typeof data?.datapack?.slug === "string" && data.datapack.slug.trim() !== ""
      ? { slug: data.datapack.slug.trim() }
      : normalizedDatapack.slug
        ? { slug: normalizedDatapack.slug }
        : {}),
    ...(typeof data?.datapack?.version === "string" && data.datapack.version.trim() !== ""
      ? { version: data.datapack.version.trim() }
      : normalizedDatapack.version
        ? { version: normalizedDatapack.version }
        : {}),
  });
  const resolvedSlug = resolvedDatapack.slug ?? normalizedDatapack.slug ?? normalizedDatapack.id;
  return Object.freeze({
    sourceKind,
    datapack: resolvedDatapack,
    key: normalizedKey,
    url:
      typeof content?.url === "string" && content.url.trim() !== ""
        ? content.url.trim()
        : sourceKind === "published"
          ? buildPublishedDatapackContentPath(resolvedSlug, normalizedKey)
          : `${sourceKind}://${encodeURIComponent(resolvedDatapack.packageName || resolvedDatapack.id)}/${encodeURIComponent(normalizedKey)}`,
    contentType:
      typeof content?.contentType === "string" && content.contentType.trim() !== ""
        ? content.contentType.trim()
        : "application/json",
    cacheKey:
      typeof content?.cacheKey === "string" && content.cacheKey.trim() !== ""
        ? content.cacheKey.trim()
        : `${sourceKind}:${resolvedDatapack.packageName || resolvedDatapack.id}:${normalizedKey}`,
    ...(typeof content?.integrity === "string" && content.integrity.trim() !== ""
      ? { integrity: content.integrity.trim() }
      : {}),
    ...(typeof content?.encoding === "string" && content.encoding.trim() !== ""
      ? { encoding: content.encoding.trim() }
      : {}),
    requiresAuth:
      typeof content?.requiresAuth === "boolean" ? content.requiresAuth : sourceKind === "published",
    expiresAt:
      typeof content?.expiresAt === "string" && content.expiresAt.trim() !== "" ? content.expiresAt.trim() : null,
    warnings: copyStringArray(normalizeDatapackWarnings([].concat(warningList, normalizeDatapackWarnings(content?.warnings)))),
  });
}

function normalizeDatapackContentValue(response) {
  const data = response?.data ?? response ?? {};
  const content = data?.content ?? null;
  if (content && Object.prototype.hasOwnProperty.call(content, "parsed")) {
    return content.parsed;
  }
  if (content && typeof content.text === "string") {
    return content.text;
  }
  return content;
}

function hasInlineDatapackContentValue(response) {
  const data = response?.data ?? response ?? {};
  const content = data?.content ?? null;
  return Boolean(
    content &&
      (Object.prototype.hasOwnProperty.call(content, "parsed") ||
        typeof content.text === "string" ||
        content.kind === "dir"),
  );
}

function resolveFetchableAssetUrl(url, assetBaseUrl) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    throw new Error("Resolved datapack content URL is missing.");
  }
  if (/^[a-z]+:\/\//i.test(normalizedUrl)) {
    return normalizedUrl;
  }
  const normalizedBase =
    typeof assetBaseUrl === "string" && assetBaseUrl.trim() !== ""
      ? assetBaseUrl.trim()
      : typeof globalThis.location?.origin === "string" && globalThis.location.origin.trim() !== ""
        ? globalThis.location.origin.trim()
        : "";
  if (!normalizedBase) {
    return normalizedUrl;
  }
  return new URL(normalizedUrl, normalizedBase).toString();
}

async function fetchResolvedDatapackContentAsset(response, options = {}) {
  const data = response?.data ?? response ?? {};
  const content = data?.content ?? null;
  const fetchImpl = options.assetFetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Reading published datapack assets requires assetFetch or global fetch.");
  }
  if (!content || typeof content !== "object" || typeof content.url !== "string" || content.url.trim() === "") {
    return normalizeDatapackContentValue(response);
  }

  const url = resolveFetchableAssetUrl(content.url, options.assetBaseUrl);
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: typeof content.contentType === "string" && content.contentType.trim() !== "" ? content.contentType.trim() : "*/*",
    },
  });
  if (!res || typeof res !== "object" || typeof res.ok !== "boolean") {
    throw new Error(`assetFetch returned an invalid response while reading "${content.url}".`);
  }
  if (!res.ok) {
    throw new Error(`Failed to read published datapack asset "${content.url}": HTTP ${res.status}`);
  }

  const contentTypeHeader = typeof res.headers?.get === "function" ? String(res.headers.get("content-type") || "") : "";
  const normalizedContentType = String(content.contentType || contentTypeHeader || "").toLowerCase();
  if (normalizedContentType.includes("json")) {
    return res.json();
  }
  if (
    normalizedContentType.startsWith("text/") ||
    normalizedContentType.includes("xml") ||
    normalizedContentType.includes("yaml") ||
    normalizedContentType.includes("csv")
  ) {
    return res.text();
  }
  return res.arrayBuffer();
}

function normalizeDatapackCandidateResult(sourceKind, datapack, key, candidate, warnings = []) {
  assertObject(candidate, `${sourceKind} datapack source candidate`);

  const response = {
    data: {
      datapack: {
        packageName:
          typeof candidate.packageName === "string" && candidate.packageName.trim() !== ""
            ? candidate.packageName.trim()
            : datapack.packageName ?? undefined,
        slug:
          typeof candidate.slug === "string" && candidate.slug.trim() !== ""
            ? candidate.slug.trim()
            : datapack.slug ?? undefined,
        version:
          typeof candidate.version === "string" && candidate.version.trim() !== ""
            ? candidate.version.trim()
            : datapack.version ?? undefined,
      },
      content: {
        url:
          typeof candidate.url === "string" && candidate.url.trim() !== ""
            ? candidate.url.trim()
            : undefined,
        contentType:
          typeof candidate.contentType === "string" && candidate.contentType.trim() !== ""
            ? candidate.contentType.trim()
            : undefined,
        cacheKey:
          typeof candidate.cacheKey === "string" && candidate.cacheKey.trim() !== ""
            ? candidate.cacheKey.trim()
            : undefined,
        integrity:
          typeof candidate.integrity === "string" && candidate.integrity.trim() !== ""
            ? candidate.integrity.trim()
            : undefined,
        encoding:
          typeof candidate.encoding === "string" && candidate.encoding.trim() !== ""
            ? candidate.encoding.trim()
            : undefined,
        requiresAuth: typeof candidate.requiresAuth === "boolean" ? candidate.requiresAuth : undefined,
        expiresAt:
          typeof candidate.expiresAt === "string" && candidate.expiresAt.trim() !== ""
            ? candidate.expiresAt.trim()
            : candidate.expiresAt === null
              ? null
              : undefined,
        warnings: normalizeDatapackWarnings(candidate.warnings),
      },
    },
  };

  const descriptor = normalizeResolvedDatapackContent(sourceKind, datapack, key, response, warnings);
  const hasValue = Object.prototype.hasOwnProperty.call(candidate, "value");
  const read =
    typeof candidate.read === "function"
      ? async () => candidate.read()
      : hasValue
        ? async () => candidate.value
        : async () => {
            throw new Error(
              `${sourceKind} datapack source for "${descriptor.datapack.packageName || descriptor.datapack.id}" and key "${descriptor.key}" does not provide value or read().`,
            );
          };

  return Object.freeze({
    descriptor,
    read,
  });
}

function flattenOperationCatalogEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.flatMap((entry) =>
    Array.isArray(entry?.operations)
      ? entry.operations.map((operation) =>
          normalizeOperationDescriptor(
            {
              kind: entry.kind,
              scope: entry.scope,
              selectors: entry.selectors,
              resolvedUser: null,
              artifactRef: null,
              artifact: null,
            },
            operation,
          ),
        )
      : [],
  );
}

function hasResolvedArtifactSelector(selector = {}) {
  return Boolean(selector.packageName || selector.slug || selector.id || selector.user || selector.operationId);
}

function buildTransportRequest(method, path, query, body, headers) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const request = {
    method: normalizedMethod,
    path,
  };
  if (query && typeof query === "object" && Object.keys(query).length > 0) {
    request.query = query;
  }
  if (headers && typeof headers === "object" && Object.keys(headers).length > 0) {
    request.headers = headers;
  }
  if (body !== undefined && normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
    request.body = body;
  }
  return request;
}

function assertTransport(transport) {
  if (!transport || typeof transport !== "object" || typeof transport.request !== "function") {
    throw new TypeError("transport.request must be a function.");
  }
}

async function resolvePublishedDatapackIdentity(transport, datapack) {
  const normalized = normalizeDatapackSelector(datapack);
  if (normalized.slug) {
    return normalized;
  }

  const packageName = normalized.packageName ?? (isPackageLikeId(normalized.id) ? normalized.id : null);
  if (packageName) {
    try {
      const response = await transport.request(
        buildTransportRequest("GET", "/api/artifacts", {
          kind: "datapack",
          packageName,
        }),
      );
      const records = Array.isArray(response?.data?.artifacts) ? response.data.artifacts : [];
      const match = records.find((entry) => typeof entry?.slug === "string" && entry.slug.trim() !== "");
      if (match) {
        return Object.freeze({
          ...normalized,
          packageName,
          slug: match.slug.trim(),
          ...(typeof match.version === "string" && match.version.trim() !== ""
            ? { version: match.version.trim() }
            : normalized.version
              ? { version: normalized.version }
              : {}),
        });
      }
    } catch {
      // Allow fallback to non-published resolution modes.
    }
  }

  if (!packageName) {
    return Object.freeze({
      ...normalized,
      slug: normalized.id,
    });
  }

  throw new Error(`Unable to resolve a published datapack release for "${packageName}".`);
}

async function tryResolveDatapackCandidate(resolver, sourceKind, datapack, key, warnings = []) {
  if (typeof resolver !== "function") {
    return null;
  }
  const candidate = await resolver({
    datapack,
    key,
  });
  if (!candidate) {
    return null;
  }
  return normalizeDatapackCandidateResult(sourceKind, datapack, key, candidate, warnings);
}

async function tryResolveRegisteredDatapackCandidate(sourceKind, datapack, key, warnings = []) {
  const registered = getRegisteredDatapackPackageSource(datapack);
  if (!registered) {
    return null;
  }
  const resolver = sourceKind === "local" ? registered.local : registered.fallback;
  if (typeof resolver !== "function") {
    return null;
  }
  const candidate = await resolver({
    datapack: registered.datapack,
    key,
  });
  if (!candidate) {
    return null;
  }
  return normalizeDatapackCandidateResult(sourceKind, registered.datapack, key, candidate, warnings);
}

async function tryResolvePublishedDatapackSource(transport, datapack, key, assetOptions = {}) {
  const publishedDatapack = await resolvePublishedDatapackIdentity(transport, datapack);
  const response = await transport.request(
    buildTransportRequest("GET", `/api/datapacks/${encodeURIComponent(publishedDatapack.slug)}/resolve-content`, {
      key,
    }),
  );
  return Object.freeze({
    descriptor: normalizeResolvedDatapackContent("published", publishedDatapack, key, response),
    async read() {
      if (hasInlineDatapackContentValue(response)) {
        return normalizeDatapackContentValue(response);
      }
      return fetchResolvedDatapackContentAsset(response, assetOptions);
    },
  });
}

async function resolveDatapackSource(transport, datapackOptions, selector, key, assetOptions = {}) {
  const datapack = normalizeDatapackSelector(selector);
  assertString(key, "datapack content key");
  const normalizedKey = key.trim();

  if (datapackOptions.mode === "local-first") {
    const local =
      (await tryResolveDatapackCandidate(datapackOptions.localResolver, "local", datapack, normalizedKey)) ||
      (await tryResolveRegisteredDatapackCandidate("local", datapack, normalizedKey));
    if (local) {
      return local;
    }

    try {
      return await tryResolvePublishedDatapackSource(transport, datapack, normalizedKey, assetOptions);
    } catch {
      const fallback =
        (await tryResolveDatapackCandidate(datapackOptions.fallbackResolver, "fallback", datapack, normalizedKey)) ||
        (await tryResolveRegisteredDatapackCandidate("fallback", datapack, normalizedKey));
      if (fallback) {
        return fallback;
      }
      throw new Error(`Unable to resolve datapack content "${normalizedKey}" for "${datapack.packageName || datapack.id}".`);
    }
  }

  try {
    return await tryResolvePublishedDatapackSource(transport, datapack, normalizedKey, assetOptions);
  } catch {
    const fallbackWarnings = [
      `Datapack "${datapack.packageName || datapack.id}" is not published in Crafter8. Using fallback distribution for content "${normalizedKey}".`,
    ];
    const fallback =
      (await tryResolveDatapackCandidate(
        datapackOptions.fallbackResolver,
        "fallback",
        datapack,
        normalizedKey,
        fallbackWarnings,
      )) ||
      (await tryResolveRegisteredDatapackCandidate("fallback", datapack, normalizedKey, fallbackWarnings));
    if (fallback) {
      return fallback;
    }
    throw new Error(`Unable to resolve datapack content "${normalizedKey}" for "${datapack.packageName || datapack.id}".`);
  }
}

export function isCrafter8HostServices(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.navigation &&
      typeof value.navigation === "object" &&
      typeof value.navigation.navigate === "function" &&
      typeof value.navigation.openItemInGraph === "function",
  );
}

export function createCrafter8HostServices(host) {
  assertObject(host, "host services");

  if (isCrafter8HostServices(host)) {
    return host;
  }

  assertHostMethod(host, "navigateToApp");
  assertHostMethod(host, "openItemInGraph");

  return Object.freeze({
    navigation: Object.freeze({
      navigate(path) {
        assertString(path, "navigation path");
        return host.navigateToApp(path.trim());
      },
      openItemInGraph(itemId) {
        assertString(itemId, "itemId");
        return host.openItemInGraph(itemId.trim());
      },
    }),
  });
}

export function createPublicHttpTransport(options) {
  assertObject(options, "public transport options");
  assertString(options.baseUrl, "public transport baseUrl");
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("public transport requires fetchImpl or global fetch.");
  }
  const auth = options.auth;

  return Object.freeze({
    async request(req) {
      assertObject(req, "transport request");
      const method = String(req.method || "GET").toUpperCase();
      const path = appendQueryToPath(req.path, req.query);
      const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
      const headers = new Headers(req.headers || {});
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
      if (auth && typeof auth.getHeaders === "function") {
        const authHeaders = await auth.getHeaders();
        if (authHeaders && typeof authHeaders === "object") {
          for (const [key, value] of Object.entries(authHeaders)) {
            if (typeof value === "string") {
              headers.set(key, value);
            }
          }
        }
      }
      const init = { method, headers };
      if (req.body !== undefined && method !== "GET" && method !== "HEAD") {
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
        init.body = headers.get("Content-Type")?.includes("application/json") ? JSON.stringify(req.body) : req.body;
      }
      const res = await fetchImpl(url, init);
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      return data;
    },
  });
}

export function createEmbeddedHostTransport(host) {
  assertObject(host, "embedded host");
  assertHostMethod(host, "fetchJson");

  return Object.freeze({
    async request(req) {
      assertObject(req, "transport request");
      const method = String(req.method || "GET").toUpperCase();
      const path = appendQueryToPath(req.path, req.query);
      const headers = { ...(req.headers || {}) };
      const init = { method, headers };
      if (req.body !== undefined && method !== "GET" && method !== "HEAD") {
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/json";
        }
        init.body =
          String(headers["Content-Type"] || headers["content-type"] || "").includes("application/json")
            ? JSON.stringify(req.body)
            : req.body;
      }
      return host.fetchJson(path, init);
    },
  });
}

export function isCrafter8Client(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.session &&
      typeof value.session === "object" &&
      typeof value.session.get === "function" &&
      value.artifacts &&
      typeof value.artifacts === "object" &&
      typeof value.artifacts.list === "function" &&
      typeof value.artifacts.get === "function" &&
      value.datapacks &&
      typeof value.datapacks === "object" &&
      typeof value.datapacks.list === "function" &&
      typeof value.datapacks.getManifest === "function" &&
      typeof value.datapacks.listContents === "function" &&
      typeof value.datapacks.resolveContent === "function" &&
      typeof value.datapacks.readContent === "function" &&
      value.operations &&
      typeof value.operations === "object" &&
      typeof value.operations.list === "function" &&
      typeof value.operations.get === "function" &&
      typeof value.operations.invoke === "function",
  );
}

export function createCrafter8Client(args) {
  assertObject(args, "client args");
  assertTransport(args.transport);
  const { transport } = args;
  const sessionResolver = args.sessionResolver;
  const datapackOptions = normalizeDatapackResolverOptions(args.datapacks);
  const assetOptions = {
    ...(typeof args.assetFetch === "function" ? { assetFetch: args.assetFetch } : {}),
    ...(typeof args.assetBaseUrl === "string" && args.assetBaseUrl.trim() !== ""
      ? { assetBaseUrl: args.assetBaseUrl.trim() }
      : {}),
  };

  const client = {
    session: Object.freeze({
      async get() {
        if (typeof sessionResolver === "function") {
          return normalizeClientSessionSnapshot(await sessionResolver());
        }
        const response = await transport.request(buildTransportRequest("GET", "/api/session/v1"));
        return normalizeClientSessionSnapshot(response?.data?.session ?? response?.data ?? response);
      },
    }),
    artifacts: Object.freeze({
      async list(selector = {}) {
        const response = await transport.request(
          buildTransportRequest("GET", "/api/artifacts", selector, undefined, undefined),
        );
        return Array.isArray(response?.data?.artifacts) ? response.data.artifacts : [];
      },
      async get(selector = {}) {
        const records = await this.list(selector);
        return records[0] ?? null;
      },
    }),
    datapacks: Object.freeze({
      async list() {
        const response = await transport.request(buildTransportRequest("GET", "/api/datapacks"));
        return Array.isArray(response?.data?.datapacks) ? response.data.datapacks : [];
      },
      async getManifest(slug) {
        assertString(slug, "datapack slug");
        const response = await transport.request(
          buildTransportRequest("GET", `/api/datapacks/${encodeURIComponent(slug.trim())}/manifest`),
        );
        return response?.data ?? response;
      },
      async listContents(slug) {
        assertString(slug, "datapack slug");
        const response = await transport.request(
          buildTransportRequest("GET", `/api/datapacks/${encodeURIComponent(slug.trim())}/contents`),
        );
        return response?.data ?? response;
      },
      async resolveContent(slug, key) {
        const resolved = await resolveDatapackSource(transport, datapackOptions, slug, key, assetOptions);
        return resolved.descriptor;
      },
      async readContent(slug, key) {
        const resolved = await resolveDatapackSource(transport, datapackOptions, slug, key, assetOptions);
        return resolved.read();
      },
    }),
    operations: Object.freeze({
      async list(selector = {}) {
        const response = await transport.request(
          buildTransportRequest("GET", "/api/artifacts/operations", selector, undefined, undefined),
        );
        const catalog = Array.isArray(response?.data?.catalog) ? response.data.catalog : [];
        const resolved = response?.data?.resolved ?? null;
        const operationId =
          typeof selector.operationId === "string" && selector.operationId.trim() !== "" ? selector.operationId.trim() : "";

        if (resolved && Array.isArray(resolved.operations) && hasResolvedArtifactSelector(selector)) {
          return resolved.operations
            .filter((operation) => (!operationId ? true : String(operation?.id || "") === operationId))
            .map((operation) => normalizeOperationDescriptor(resolved, operation));
        }

        return flattenOperationCatalogEntries(catalog).filter((entry) =>
          !operationId ? true : String(entry.operation?.id || "") === operationId,
        );
      },
      async get(selector) {
        assertObject(selector, "operation selector");
        const response = await transport.request(
          buildTransportRequest("GET", "/api/artifacts/operations", selector, undefined, undefined),
        );
        const resolved = response?.data?.resolved ?? null;
        const operationId =
          typeof selector.operationId === "string" && selector.operationId.trim() !== "" ? selector.operationId.trim() : "";

        if (resolved && Array.isArray(resolved.operations)) {
          const operation = operationId
            ? resolved.operations.find((entry) => String(entry?.id || "") === operationId)
            : resolved.operations[0];
          return operation ? normalizeOperationDescriptor(resolved, operation) : null;
        }

        const catalogEntries = flattenOperationCatalogEntries(Array.isArray(response?.data?.catalog) ? response.data.catalog : []);
        return operationId
          ? catalogEntries.find((entry) => String(entry.operation?.id || "") === operationId) ?? null
          : catalogEntries[0] ?? null;
      },
      async invoke(selector, input) {
        assertObject(selector, "operation selector");
        const resolved = await this.get(selector);
        if (!resolved) {
          throw new Error("Operation not found.");
        }
        const request = buildOperationRequest(resolved.operation, selector, input);
        const response = await transport.request(request);
        return response?.data ?? response;
      },
    }),
  };

  return Object.freeze(client);
}

export function createEmbeddedCrafter8Client(host, options = {}) {
  assertObject(host, "embedded host");
  if (isCrafter8Client(host)) {
    return host;
  }
  const transport = createEmbeddedHostTransport(host);
  if (options === null || typeof options !== "object") {
    throw new TypeError("embedded client options must be an object.");
  }
  return createCrafter8Client({
    transport,
    ...(options.datapacks ? { datapacks: options.datapacks } : {}),
    ...(typeof options.assetFetch === "function" ? { assetFetch: options.assetFetch } : {}),
    ...(typeof options.assetBaseUrl === "string" && options.assetBaseUrl.trim() !== ""
      ? { assetBaseUrl: options.assetBaseUrl.trim() }
      : {}),
  });
}

export function createEmbeddedCrafter8Environment(host, options = {}) {
  assertObject(host, "embedded host");
  if (options === null || typeof options !== "object") {
    throw new TypeError("embedded environment options must be an object.");
  }

  const client = createEmbeddedCrafter8Client(host, options);
  const hostServices = createCrafter8HostServices(host);
  const environment = {
    client,
    host: hostServices,
  };

  if (options.includeLegacyRuntime === true) {
    environment.runtime = createHostRuntimeApiV1(host);
  }

  return Object.freeze(environment);
}

function assertObject(value, name) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${name} must be an object.`);
  }
}

function assertHostMethod(host, name) {
  if (typeof host?.[name] !== "function") {
    throw new TypeError(`host.${name} must be a function.`);
  }
}

function safeSession(host) {
  if (typeof host?.session !== "function") {
    return {};
  }
  const session = host.session();
  return session && typeof session === "object" ? session : {};
}

function parseHostApiLabel(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return { hostApi: value, hostApiLabel: `${value}.0.0` };
  }

  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d+)/);
    const hostApi = match ? Number(match[1]) : HOST_API_V1;
    return { hostApi, hostApiLabel: trimmed };
  }

  return { hostApi: HOST_API_V1, hostApiLabel: `${HOST_API_V1}.0.0` };
}

function normalizeHostRuntimeVersion(host) {
  if (isHostRuntimeApiV1(host)) {
    return host.version;
  }

  const session = safeSession(host);
  const versionSource = host?.version ?? session.hostApiVersion ?? HOST_API_V1;
  return parseHostApiLabel(versionSource);
}

function normalizeCapabilityList(host) {
  const session = safeSession(host);
  return Array.isArray(session.capabilities)
    ? copyStringArray(session.capabilities.filter((entry) => typeof entry === "string"))
    : [];
}

function normalizeOperationKinds(selector = {}) {
  const normalizedKind = typeof selector.kind === "string" && selector.kind.trim() !== "" ? selector.kind.trim() : "";
  if (normalizedKind) {
    return [normalizedKind];
  }
  return ["module", "app", "datapack", "engine", "user-app", "datapack-workspace"];
}

function buildLegacyOperationSelector(kind, selector = {}) {
  const result = { kind };
  for (const key of ["slug", "id", "packageName", "user"]) {
    const value = selector[key];
    if (typeof value === "string" && value.trim() !== "") {
      result[key] = value.trim();
    }
  }
  return result;
}

function normalizeOperationDescriptor(base, operation) {
  return Object.freeze({
    kind: String(base.kind || ""),
    scope: String(base.scope || ""),
    selectors: base.selectors ?? {},
    resolvedUser: typeof base.resolvedUser === "string" ? base.resolvedUser : null,
    artifactRef: typeof base.artifactRef === "string" ? base.artifactRef : null,
    artifact: base.artifact ?? null,
    operation,
  });
}

async function resolveOperationCollection(host, selector = {}) {
  if (typeof host?.getArtifactOperations !== "function") {
    return null;
  }

  const kinds = normalizeOperationKinds(selector);
  for (const kind of kinds) {
    try {
      const resolved = await host.getArtifactOperations(buildLegacyOperationSelector(kind, selector));
      if (resolved && Array.isArray(resolved.operations) && resolved.operations.length > 0) {
        return resolved;
      }
    } catch {
      // Try next candidate kind.
    }
  }
  return null;
}

function appendQueryToPath(path, query) {
  if (!query || typeof query !== "object") {
    return path;
  }

  const search = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null) continue;
    if (Array.isArray(rawValue)) {
      for (const entry of rawValue) {
        if (entry === undefined || entry === null) continue;
        search.append(key, String(entry));
      }
      continue;
    }
    search.set(key, String(rawValue));
  }

  const suffix = search.toString();
  if (!suffix) {
    return path;
  }
  return `${path}${path.includes("?") ? "&" : "?"}${suffix}`;
}

function resolveOperationPath(operation, selector = {}, input) {
  const directPath = typeof operation?.path === "string" && operation.path.trim() !== "" ? operation.path.trim() : "";
  if (directPath) {
    return directPath;
  }

  const template = typeof operation?.pathTemplate === "string" && operation.pathTemplate.trim() !== "" ? operation.pathTemplate.trim() : "";
  if (!template) {
    throw new Error(`Operation "${String(operation?.id || "(unknown)")}" is missing a path or pathTemplate.`);
  }

  const pathParams =
    (selector && typeof selector.pathParams === "object" && selector.pathParams) ||
    (input && typeof input === "object" && input.pathParams && typeof input.pathParams === "object" ? input.pathParams : null) ||
    (input && typeof input === "object" && input.params && typeof input.params === "object" ? input.params : null) ||
    {};

  return template
    .replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name) => {
      const value = pathParams[name];
      if (value === undefined || value === null || value === "") {
        throw new Error(`Operation path parameter "${name}" is required.`);
      }
      return encodeURIComponent(String(value));
    })
    .replace(/:([A-Za-z0-9_]+)/g, (_match, name) => {
      const value = pathParams[name];
      if (value === undefined || value === null || value === "") {
        throw new Error(`Operation path parameter "${name}" is required.`);
      }
      return encodeURIComponent(String(value));
    });
}

function buildOperationRequest(operation, selector = {}, input) {
  const method = String(operation?.method || "GET").toUpperCase();
  const query =
    (selector && typeof selector.query === "object" && selector.query) ||
    (input && typeof input === "object" && input.query && typeof input.query === "object" ? input.query : null) ||
    null;

  let body;
  if (selector && Object.prototype.hasOwnProperty.call(selector, "body")) {
    body = selector.body;
  } else if (input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "body")) {
    body = input.body;
  } else if (method !== "GET" && method !== "HEAD" && input !== undefined) {
    body = input;
  }

  const path = appendQueryToPath(resolveOperationPath(operation, selector, input), query);
  const headers = body !== undefined && method !== "GET" && method !== "HEAD" ? { "Content-Type": "application/json" } : undefined;
  return buildTransportRequest(method, path, undefined, body, headers);
}

export function isHostRuntimeApiV1(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.version &&
      typeof value.version === "object" &&
      Number.isInteger(value.version.hostApi) &&
      typeof value.version.hostApiLabel === "string" &&
      value.session &&
      typeof value.session === "object" &&
      typeof value.session.get === "function" &&
      value.capabilities &&
      typeof value.capabilities === "object" &&
      typeof value.capabilities.list === "function" &&
      typeof value.capabilities.has === "function" &&
      typeof value.capabilities.assert === "function" &&
      value.navigation &&
      typeof value.navigation === "object" &&
      typeof value.navigation.navigate === "function" &&
      typeof value.navigation.openItemInGraph === "function" &&
      value.datapacks &&
      typeof value.datapacks === "object" &&
      typeof value.datapacks.list === "function" &&
      typeof value.datapacks.getManifest === "function" &&
      typeof value.datapacks.listContents === "function" &&
      typeof value.datapacks.readContent === "function" &&
      value.modules &&
      typeof value.modules === "object" &&
      typeof value.modules.list === "function" &&
      typeof value.modules.load === "function" &&
      value.operations &&
      typeof value.operations === "object" &&
      typeof value.operations.list === "function" &&
      typeof value.operations.get === "function" &&
      typeof value.operations.invoke === "function"
  );
}

export function createHostRuntimeApiV1(host) {
  assertObject(host, "host");

  if (isHostRuntimeApiV1(host)) {
    return host;
  }

  assertHostMethod(host, "navigateToApp");
  assertHostMethod(host, "openItemInGraph");
  assertHostMethod(host, "listDatapacks");
  assertHostMethod(host, "getDatapackManifest");
  assertHostMethod(host, "listDatapackContents");
  assertHostMethod(host, "readDatapackContent");
  assertHostMethod(host, "listModules");
  assertHostMethod(host, "loadModule");
  assertHostMethod(host, "session");
  assertHostMethod(host, "hasCapability");
  assertHostMethod(host, "assertCapability");

  const version = Object.freeze(normalizeHostRuntimeVersion(host));

  const runtime = {
    version,
    session: Object.freeze({
      get() {
        const session = safeSession(host);
        return Object.freeze({
          apiBaseUrl: typeof session.apiBaseUrl === "string" ? session.apiBaseUrl : "",
          activeWorkspaceId: typeof session.activeWorkspaceId === "string" ? session.activeWorkspaceId : "",
          activeWorkspaceName: typeof session.activeWorkspaceName === "string" ? session.activeWorkspaceName : null,
          scenarioIds: typeof session.scenarioIds === "string" ? session.scenarioIds : "",
          ...(typeof session.userId === "string" && session.userId ? { userId: session.userId } : {}),
          ...(typeof session.userDisplayName === "string" || session.userDisplayName === null
            ? { userDisplayName: session.userDisplayName ?? null }
            : {}),
          capabilities: normalizeCapabilityList(host),
          hostApi: version.hostApi,
          hostApiLabel: version.hostApiLabel,
        });
      },
    }),
    capabilities: Object.freeze({
      list() {
        return normalizeCapabilityList(host);
      },
      has(capability) {
        assertString(capability, "capability");
        return Boolean(host.hasCapability(capability.trim()));
      },
      assert(capability) {
        assertString(capability, "capability");
        return host.assertCapability(capability.trim());
      },
    }),
    navigation: Object.freeze({
      navigate(path) {
        assertString(path, "navigation path");
        return host.navigateToApp(path.trim());
      },
      openItemInGraph(itemId) {
        assertString(itemId, "itemId");
        return host.openItemInGraph(itemId.trim());
      },
    }),
    datapacks: Object.freeze({
      list() {
        return host.listDatapacks();
      },
      getManifest(slug) {
        assertString(slug, "datapack slug");
        return host.getDatapackManifest(slug.trim());
      },
      listContents(slug) {
        assertString(slug, "datapack slug");
        return host.listDatapackContents(slug.trim());
      },
      readContent(slug, key) {
        assertString(slug, "datapack slug");
        assertString(key, "datapack content key");
        return host.readDatapackContent(slug.trim(), key.trim());
      },
    }),
    modules: Object.freeze({
      list() {
        return host.listModules();
      },
      load(packageName) {
        assertString(packageName, "module packageName");
        return host.loadModule(packageName.trim());
      },
    }),
    operations: Object.freeze({
      async list(selector = {}) {
        if (selector && (selector.packageName || selector.slug || selector.id || selector.user || selector.operationId)) {
          const resolved = await resolveOperationCollection(host, selector);
          if (!resolved) {
            return [];
          }
          const operationId =
            typeof selector.operationId === "string" && selector.operationId.trim() !== "" ? selector.operationId.trim() : "";
          return resolved.operations
            .filter((operation) => (!operationId ? true : String(operation?.id || "") === operationId))
            .map((operation) => normalizeOperationDescriptor(resolved, operation));
        }

        if (typeof host.listArtifactOperationCatalog !== "function") {
          return [];
        }

        const catalog = await host.listArtifactOperationCatalog(
          typeof selector.kind === "string" && selector.kind.trim() !== "" ? selector.kind.trim() : undefined,
        );
        return catalog.flatMap((entry) =>
          Array.isArray(entry?.operations)
            ? entry.operations.map((operation) =>
                normalizeOperationDescriptor(
                  {
                    kind: entry.kind,
                    scope: entry.scope,
                    selectors: entry.selectors,
                    resolvedUser: null,
                    artifactRef: null,
                    artifact: null,
                  },
                  operation,
                ),
              )
            : [],
        );
      },
      async get(selector) {
        assertObject(selector, "operation selector");
        const resolved = await resolveOperationCollection(host, selector);
        if (!resolved) {
          return null;
        }
        const operationId =
          typeof selector.operationId === "string" && selector.operationId.trim() !== "" ? selector.operationId.trim() : "";
        const operation = operationId
          ? resolved.operations.find((entry) => String(entry?.id || "") === operationId)
          : resolved.operations[0];
        if (!operation) {
          return null;
        }
        return normalizeOperationDescriptor(resolved, operation);
      },
      async invoke(selector, input) {
        assertObject(selector, "operation selector");
        if (typeof host.invokeOperation === "function") {
          return host.invokeOperation(selector, input);
        }

        const resolved = await this.get(selector);
        if (!resolved) {
          throw new Error("Operation not found.");
        }

        if (typeof host.fetchJson !== "function") {
          throw new Error("Current host does not implement operation invocation.");
        }

        const request = buildOperationRequest(resolved.operation, selector, input);
        const init = { method: request.method };
        if (request.headers) {
          init.headers = request.headers;
        }
        if (request.body !== undefined && request.method !== "GET" && request.method !== "HEAD") {
          init.body = JSON.stringify(request.body);
        }
        return host.fetchJson(request.path, init);
      },
    }),
  };

  return Object.freeze(runtime);
}

function normalizeRuntimeArtifact(kind, artifact) {
  if (!isPlainObject(artifact)) {
    throw new TypeError(`artifact must be an object for ${kind} context.`);
  }

  assertString(artifact.id, `${kind} artifact.id`);
  assertString(artifact.version, `${kind} artifact.version`);
  assertOptionalString(artifact.name, `${kind} artifact.name`);
  assertOptionalString(artifact.summary, `${kind} artifact.summary`);

  const normalized = {
    kind,
    id: artifact.id.trim(),
    version: artifact.version.trim(),
    ...(artifact.name ? { name: artifact.name.trim() } : {}),
    ...(artifact.summary ? { summary: artifact.summary.trim() } : {}),
  };

  if (Array.isArray(artifact.capabilities) && artifact.capabilities.length > 0) {
    normalized.capabilities = copyStringArray(artifact.capabilities.filter((entry) => typeof entry === "string"));
  }

  if (isPlainObject(artifact.dependencies)) {
    const dependencies = {};
    if (Array.isArray(artifact.dependencies.modules) && artifact.dependencies.modules.length > 0) {
      dependencies.modules = copyStringArray(artifact.dependencies.modules.filter((entry) => typeof entry === "string"));
    }
    if (Array.isArray(artifact.dependencies.datapacks) && artifact.dependencies.datapacks.length > 0) {
      dependencies.datapacks = copyStringArray(
        artifact.dependencies.datapacks.filter((entry) => typeof entry === "string"),
      );
    }
    addOptionalObject(normalized, "dependencies", dependencies);
  }

  if (isPlainObject(artifact.uses)) {
    const uses = {};
    if (Array.isArray(artifact.uses.modules) && artifact.uses.modules.length > 0) {
      uses.modules = copyStringArray(artifact.uses.modules.filter((entry) => typeof entry === "string"));
    }
    if (Array.isArray(artifact.uses.datapacks) && artifact.uses.datapacks.length > 0) {
      uses.datapacks = copyStringArray(artifact.uses.datapacks.filter((entry) => typeof entry === "string"));
    }
    addOptionalObject(normalized, "uses", uses);
  }

  if (isPlainObject(artifact.provides)) {
    normalized.provides = { ...artifact.provides };
  }

  return Object.freeze(normalized);
}

export function createAppContext(args) {
  assertObject(args, "app context args");
  const hasHTMLElement = typeof HTMLElement !== "undefined";
  const isValidContainer = hasHTMLElement
    ? args.container instanceof HTMLElement
    : args.container !== null && typeof args.container === "object";
  if (!isValidContainer) {
    throw new TypeError("app context container must be a DOM element-like object.");
  }

  const client = (() => {
    if (isCrafter8Client(args.client)) {
      return args.client;
    }
    if (args.host) {
      return createEmbeddedCrafter8Client(args.host);
    }
    throw new TypeError("app context requires client or host.");
  })();

  const hostServices = (() => {
    if (args.hostServices) {
      return createCrafter8HostServices(args.hostServices);
    }
    if (args.host) {
      return createCrafter8HostServices(args.host);
    }
    return undefined;
  })();

  const runtime = (() => {
    if (args.runtime) {
      return createHostRuntimeApiV1(args.runtime);
    }
    if (args.host) {
      return createHostRuntimeApiV1(args.host);
    }
    return undefined;
  })();

  return Object.freeze({
    client,
    ...(hostServices ? { host: hostServices } : {}),
    ...(runtime ? { runtime } : {}),
    container: args.container,
    artifact: normalizeRuntimeArtifact("app", args.artifact),
  });
}

export function createModuleContext(args) {
  assertObject(args, "module context args");

  const client = (() => {
    if (isCrafter8Client(args.client)) {
      return args.client;
    }
    if (args.host) {
      return createEmbeddedCrafter8Client(args.host);
    }
    throw new TypeError("module context requires client or host.");
  })();

  const runtime = (() => {
    if (args.runtime) {
      return createHostRuntimeApiV1(args.runtime);
    }
    if (args.host) {
      return createHostRuntimeApiV1(args.host);
    }
    return undefined;
  })();

  return Object.freeze({
    client,
    ...(runtime ? { runtime } : {}),
    artifact: normalizeRuntimeArtifact("module", args.artifact),
  });
}

function addOptionalString(target, key, value) {
  if (typeof value === "string" && value.trim() !== "") {
    target[key] = value.trim();
  }
}

function addOptionalArray(target, key, value) {
  if (Array.isArray(value) && value.length > 0) {
    target[key] = value;
  }
}

function addOptionalObject(target, key, value) {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    target[key] = value;
  }
}

function normalizePlatform(options) {
  const specVersion = options.specVersion ?? ARTIFACT_SPEC_V2;
  const hostApi = options.hostApi ?? HOST_API_V1;

  if (!Number.isInteger(specVersion) || specVersion <= 0) {
    throw new TypeError("platform.specVersion must be a positive integer.");
  }

  if (!Number.isInteger(hostApi) || hostApi <= 0) {
    throw new TypeError("platform.hostApi must be a positive integer.");
  }

  return { specVersion, hostApi };
}

function buildUsesBlock(definition) {
  const uses = {};
  addOptionalArray(uses, "modules", definition.uses?.modules);
  addOptionalArray(uses, "datapacks", definition.uses?.datapacks);
  return uses;
}

function normalizeGeneratedDependencies(input) {
  if (input === undefined) {
    return { modules: [], datapacks: [] };
  }
  if (!isPlainObject(input)) {
    throw new TypeError("artifact dependencies must be an object.");
  }
  const normalized = {
    modules: [],
    datapacks: [],
  };
  if (input.modules !== undefined) {
    if (!Array.isArray(input.modules)) {
      throw new TypeError("artifact dependencies.modules must be an array.");
    }
    normalized.modules = copyStringArray(input.modules.map((entry) => readArtifactRef(entry, "module").id));
  }
  if (input.datapacks !== undefined) {
    if (!Array.isArray(input.datapacks)) {
      throw new TypeError("artifact dependencies.datapacks must be an array.");
    }
    normalized.datapacks = copyStringArray(input.datapacks.map((entry) => readArtifactRef(entry, "datapack").id));
  }
  return normalized;
}

function buildPrimaryDependenciesBlock(definition, options) {
  const generated = normalizeGeneratedDependencies(options.dependencies);
  const modules = copyStringArray([...(generated.modules || []), ...(definition.uses?.modules || [])]);
  const datapacks = copyStringArray([...(generated.datapacks || []), ...(definition.uses?.datapacks || [])]);
  const block = {};
  addOptionalArray(block, "modules", modules);
  addOptionalArray(block, "datapacks", datapacks);
  return block;
}

function buildProvidesBlock(definition) {
  if (definition.kind === "module") {
    const provides = {};
    const exportNames = Object.keys(definition.provides.exports);
    addOptionalArray(provides, "exports", exportNames);
    addOptionalArray(provides, "operations", definition.provides.operations);
    return provides;
  }

  if (definition.kind === "datapack") {
    const provides = {};
    addOptionalString(provides, "profile", definition.provides.profile);
    return provides;
  }

  return {};
}

function validateForSpecVersion(definition, specVersion) {
  if (specVersion === ARTIFACT_SPEC_V1) {
    return;
  }

  if (specVersion !== ARTIFACT_SPEC_V2) {
    throw new TypeError(`Unsupported artifact spec version ${specVersion}.`);
  }

  if (definition.kind === "app" && definition.capabilities.length === 0) {
    throw new TypeError("V2 app manifests require at least one capability.");
  }

  if (definition.kind === "module" && Object.keys(definition.provides.exports).length === 0) {
    throw new TypeError("V2 module manifests require at least one provided export.");
  }

  if (definition.kind === "datapack" && !definition.provides.profile) {
    throw new TypeError("V2 datapack manifests require provides.profile.");
  }
}

export function generateArtifactManifest(definition, options = {}) {
  if (!isArtifactDefinition(definition)) {
    throw new TypeError("generateArtifactManifest expects a Crafter8 definition created by the SDK.");
  }

  const version = options.version;
  assertString(version, "artifact version");

  const platform = normalizePlatform(options);
  validateForSpecVersion(definition, platform.specVersion);

  const manifest = {
    kind: definition.kind,
    id: definition.id,
    version: version.trim(),
    platform,
  };

  addOptionalString(manifest, "name", definition.name);
  addOptionalString(manifest, "summary", definition.summary);

  if (platform.specVersion >= ARTIFACT_SPEC_V2) {
    addOptionalArray(manifest, "capabilities", definition.capabilities);
    addOptionalObject(manifest, "provides", buildProvidesBlock(definition));
    addOptionalObject(manifest, "dependencies", buildPrimaryDependenciesBlock(definition, options));
    if (options.legacyUses === true) {
      addOptionalObject(manifest, "uses", buildUsesBlock(definition));
    }
  }

  if (definition.kind === "datapack") {
    addOptionalObject(manifest, "contents", definition.contents);
  }

  return manifest;
}
