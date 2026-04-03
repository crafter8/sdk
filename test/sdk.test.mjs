import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ARTIFACT_SPEC_V1,
  ARTIFACT_SPEC_V2,
  createAppContext,
  createCrafter8Client,
  createCrafter8HostServices,
  createEmbeddedCrafter8Client,
  createEmbeddedCrafter8Environment,
  createHostRuntimeApiV1,
  createDatapackRef,
  createModuleRef,
  defineApp,
  defineDatapack,
  defineModule,
  generateArtifactManifest,
  isArtifactDefinition,
  registerDatapackPackageSource,
} from "../index.js";
import { buildArtifact } from "../build.js";
import { createCrafter8ReactBindings } from "../react.js";
import {
  createMockAppContext,
  createMockCrafter8Client,
  createMockCrafter8Environment,
  createMockCrafter8HostServices,
} from "../mock.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sdkDir = path.resolve(__dirname, "..");
const sdkEntryUrl = pathToFileURL(path.join(sdkDir, "index.js")).href;
const fixturesDir = path.join(__dirname, "fixtures");

test("defineApp creates a Crafter8 app definition", () => {
  const app = defineApp({
    id: "@leo/stash-browser",
    name: "Stash Browser",
    capabilities: ["datapacks.read"],
    uses: {
      modules: [createModuleRef("@leo/graph-tools")],
      datapacks: [createDatapackRef("@leo/arcraiders-data")],
    },
    mount() {},
  });

  assert.equal(app.kind, "app");
  assert.equal(app.id, "@leo/stash-browser");
  assert.deepEqual(app.uses.modules, ["@leo/graph-tools"]);
  assert.deepEqual(app.uses.datapacks, ["@leo/arcraiders-data"]);
  assert.ok(isArtifactDefinition(app));
});

test("defineApp supports component-based apps without creator-written mount", () => {
  function ProbeComponent() {
    return null;
  }

  const app = defineApp({
    id: "community.component-probe",
    name: "Component Probe",
    capabilities: ["graph.read"],
    component: ProbeComponent,
  });

  assert.equal(app.kind, "app");
  assert.equal(app.component, ProbeComponent);
  assert.equal(app.mount, undefined);
});

test("generateArtifactManifest creates a V1 manifest", () => {
  const moduleDefinition = defineModule({
    id: "@leo/planner-core",
    name: "Planner Core",
    exports: {
      plan() {},
    },
  });

  const manifest = generateArtifactManifest(moduleDefinition, {
    version: "1.0.0",
    specVersion: ARTIFACT_SPEC_V1,
  });

  assert.deepEqual(manifest, {
    kind: "module",
    id: "@leo/planner-core",
    version: "1.0.0",
    platform: {
      specVersion: 1,
      hostApi: 1,
    },
    name: "Planner Core",
  });
});

test("generateArtifactManifest creates a V2 module manifest with dependencies/provides/capabilities", () => {
  const moduleDefinition = defineModule({
    id: "@leo/planner-core",
    name: "Planner Core",
    capabilities: ["graph.read"],
    uses: {
      modules: [createModuleRef("@leo/base-utils")],
      datapacks: [createDatapackRef("@leo/arcraiders-data")],
    },
    provides: {
      exports: {
        plan() {},
        summarizeMap() {},
      },
      operations: ["plan"],
    },
  });

  const manifest = generateArtifactManifest(moduleDefinition, {
    version: "1.0.0",
    specVersion: ARTIFACT_SPEC_V2,
  });

  assert.deepEqual(manifest, {
    kind: "module",
    id: "@leo/planner-core",
    version: "1.0.0",
    platform: {
      specVersion: 2,
      hostApi: 1,
    },
    name: "Planner Core",
    capabilities: ["graph.read"],
    dependencies: {
      modules: ["@leo/base-utils"],
      datapacks: ["@leo/arcraiders-data"],
    },
    provides: {
      exports: ["plan", "summarizeMap"],
      operations: ["plan"],
    },
  });
});

test("generateArtifactManifest adds generated dependencies separately from uses", () => {
  const app = defineApp({
    id: "community.remote-item-probe",
    name: "Remote Item Probe",
    capabilities: ["graph.read", "datapacks.read"],
    mount() {},
  });

  const manifest = generateArtifactManifest(app, {
    version: "0.1.0",
    specVersion: ARTIFACT_SPEC_V2,
    dependencies: {
      datapacks: [createDatapackRef("@crafter8/example-probe-datapack")],
    },
  });

  assert.deepEqual(manifest, {
    kind: "app",
    id: "community.remote-item-probe",
    version: "0.1.0",
    platform: {
      specVersion: 2,
      hostApi: 1,
    },
    name: "Remote Item Probe",
    capabilities: ["graph.read", "datapacks.read"],
    dependencies: {
      datapacks: ["@crafter8/example-probe-datapack"],
    },
  });
});

test("generateArtifactManifest can include legacy uses when explicitly requested", () => {
  const app = defineApp({
    id: "community.legacy-app",
    name: "Legacy App",
    capabilities: ["graph.read"],
    uses: {
      modules: [createModuleRef("@leo/graph-tools")],
      datapacks: [createDatapackRef("@leo/arcraiders-data")],
    },
    mount() {},
  });

  const manifest = generateArtifactManifest(app, {
    version: "0.1.0",
    specVersion: ARTIFACT_SPEC_V2,
    legacyUses: true,
  });

  assert.deepEqual(manifest.uses, {
    modules: ["@leo/graph-tools"],
    datapacks: ["@leo/arcraiders-data"],
  });
  assert.deepEqual(manifest.dependencies, {
    modules: ["@leo/graph-tools"],
    datapacks: ["@leo/arcraiders-data"],
  });
});

test("V2 datapack manifests require provides.profile", () => {
  const datapack = defineDatapack({
    id: "@leo/arcraiders-data",
    name: "ARC Raiders Data",
    contents: {
      root: "./data",
    },
  });

  assert.throws(
    () =>
      generateArtifactManifest(datapack, {
        version: "1.0.0",
        specVersion: ARTIFACT_SPEC_V2,
      }),
    /provides\.profile/
  );
});

test("buildArtifact writes a V2 manifest from declaration entry", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crafter8-sdk-"));
  const entry = path.join(fixturesDir, "module-entry.mjs");

  const { manifest, manifestPath } = await buildArtifact({
    entry,
    outDir: tempDir,
    specVersion: ARTIFACT_SPEC_V2,
  });

  assert.equal(manifest.kind, "module");
  assert.equal(manifest.id, "@leo/planner-core");
  assert.equal(manifest.version, "0.0.1");
  assert.deepEqual(manifest.dependencies, {
    modules: ["@leo/base-utils"],
    datapacks: ["@leo/arcraiders-data"],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, "uses"), false);
  assert.ok(manifestPath);
  assert.ok(fs.existsSync(manifestPath));

  const written = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.deepEqual(written, manifest);
});

test("buildArtifact can emit a minimal published community datapack release", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crafter8-sdk-publish-"));
  const pkgDir = path.join(tempDir, "example-datapack");
  const dataDir = path.join(pkgDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: "@acme/example-datapack",
        version: "2.3.4",
        type: "module",
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(pkgDir, "crafter8.mjs"),
    `
      import { defineDatapack } from ${JSON.stringify(sdkEntryUrl)};
      export default defineDatapack({
        id: "@acme/example-datapack",
        name: "Example Datapack",
        summary: "Example published datapack",
        contents: {
          root: "./data",
          manifest: "./data/manifest.json"
        },
        provides: {
          profile: "example/v1"
        }
      });
    `,
  );
  fs.writeFileSync(path.join(dataDir, "manifest.json"), JSON.stringify({ name: "Example Datapack" }, null, 2));
  fs.writeFileSync(path.join(dataDir, "items.json"), JSON.stringify({ items: [] }, null, 2));

  const result = await buildArtifact({
    entry: path.join(pkgDir, "crafter8.mjs"),
    outDir: path.join(pkgDir, "dist"),
    emitCommunityDatapack: true,
    publicationDir: pkgDir,
  });

  assert.equal(result.definition.kind, "datapack");
  assert.ok(fs.existsSync(path.join(pkgDir, "community-datapack.manifest.json")));
  assert.ok(fs.existsSync(path.join(pkgDir, "community-datapacks.json")));

  const publicationManifest = JSON.parse(fs.readFileSync(path.join(pkgDir, "community-datapack.manifest.json"), "utf8"));
  const publicationRegistry = JSON.parse(fs.readFileSync(path.join(pkgDir, "community-datapacks.json"), "utf8"));
  assert.equal(publicationManifest.packageName, "@acme/example-datapack");
  assert.equal(publicationManifest.version, "2.3.4");
  assert.deepEqual(publicationManifest.contents.map((entry) => entry.key), ["manifest", "items"]);
  assert.equal(publicationRegistry[0]?.slug, "example-datapack");
  assert.equal(publicationRegistry[0]?.version, "2.3.4");
});

test("buildArtifact extracts Crafter8 datapack dependencies from runtime entry imports", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crafter8-sdk-deps-"));
  const appDir = path.join(tempDir, "app");
  const srcDir = path.join(appDir, "src");
  const pkgDir = path.join(appDir, "node_modules", "@acme", "test-datapack");
  const sdkUrl = sdkEntryUrl;
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(pkgDir, { recursive: true });

  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-app",
        version: "1.0.0",
        type: "module",
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(srcDir, "index.mjs"),
    'import "@acme/test-datapack";\nexport function mountCommunityApp() {}\n',
  );
  fs.writeFileSync(
    path.join(srcDir, "crafter8.mjs"),
    `import { defineApp } from ${JSON.stringify(sdkUrl)};\nexport default defineApp({ id: "community.fixture-app", name: "Fixture App", capabilities: ["datapacks.read"], mount() {} });\n`,
  );
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: "@acme/test-datapack",
        version: "1.2.3",
        type: "module",
        exports: {
          ".": "./index.js",
          "./crafter8": "./crafter8.mjs",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(pkgDir, "index.js"), "export const ok = true;\n");
  fs.writeFileSync(
    path.join(pkgDir, "crafter8.mjs"),
    `import { defineDatapack } from ${JSON.stringify(sdkUrl)};\nexport default defineDatapack({ id: "@acme/test-datapack", name: "Test Datapack", contents: { root: "./data" }, provides: { profile: "test/v1" } });\n`,
  );

  const { manifest } = await buildArtifact({
    entry: path.join(srcDir, "crafter8.mjs"),
    runtimeEntry: path.join(srcDir, "index.mjs"),
    outDir: path.join(tempDir, "dist"),
    specVersion: ARTIFACT_SPEC_V2,
  });

  assert.deepEqual(manifest.dependencies, {
    datapacks: ["@acme/test-datapack"],
  });
});

test("mock Crafter8 client serves canonical session, artifacts, datapacks and operations", async () => {
  const client = createMockCrafter8Client({
    session: {
      authenticated: true,
      userId: "mock-user",
      capabilities: ["graph.read", "datapacks.read"],
    },
    artifacts: [
      {
        kind: "module",
        packageName: "@crafter8/graph-utils",
        slug: "graph-utils",
        id: "community.graph-utils",
        version: "0.1.0",
        name: "Graph Utils",
      },
    ],
    datapacks: [
      {
        packageName: "@crafter8/example-probe-datapack",
        slug: "example-probe-datapack",
        id: "@crafter8/example-probe-datapack",
        version: "0.1.0",
        name: "Example Probe Datapack",
        manifest: {
          name: "Example Probe Datapack",
          version: "0.1.0",
        },
        contentValues: {
          manifest: {
            name: "Example Probe Datapack",
          },
        },
      },
    ],
    operations: [
      {
        kind: "engine",
        selectors: {
          kind: "engine",
          packageName: "@crafter8/resource-graph-core",
        },
        artifact: {
          kind: "engine",
          packageName: "@crafter8/resource-graph-core",
          slug: "resource-graph-core",
          id: "engine.resource-graph-core",
        },
        operation: {
          id: "read-engine-discovery",
          method: "POST",
          path: "/api/mock/operations/read-engine-discovery",
        },
        result: {
          ok: true,
        },
      },
    ],
  });

  const session = await client.session.get();
  const artifacts = await client.artifacts.list({ kind: "module" });
  const datapacks = await client.datapacks.list();
  const resolvedContent = await client.datapacks.resolveContent("@crafter8/example-probe-datapack", "manifest");
  const operation = await client.operations.get({
    kind: "engine",
    packageName: "@crafter8/resource-graph-core",
    operationId: "read-engine-discovery",
  });
  const invoked = await client.operations.invoke({
    kind: "engine",
    packageName: "@crafter8/resource-graph-core",
    operationId: "read-engine-discovery",
  });

  assert.equal(session.userId, "mock-user");
  assert.deepEqual(session.capabilities, ["datapacks.read", "graph.read"]);
  assert.equal(artifacts[0]?.packageName, "@crafter8/graph-utils");
  assert.equal(datapacks[0]?.slug, "example-probe-datapack");
  assert.equal(resolvedContent.sourceKind, "published");
  assert.equal(operation?.operation?.id, "read-engine-discovery");
  assert.deepEqual(invoked, { ok: true });
});

test("mock app context and environment provide standalone app harness primitives", () => {
  const host = createMockCrafter8HostServices();
  const client = createMockCrafter8Client();
  const appContext = createMockAppContext({
    client,
    hostServices: host,
    artifact: {
      id: "community.mock-app",
      version: "0.1.0",
      name: "Mock App",
    },
  });
  const environment = createMockCrafter8Environment({
    artifact: {
      id: "community.mock-app",
      version: "0.1.0",
      name: "Mock App",
    },
  });

  assert.equal(appContext.artifact.id, "community.mock-app");
  assert.equal(typeof appContext.client.session.get, "function");
  assert.equal(typeof appContext.host.navigation.navigate, "function");
  assert.equal(environment.appContext.artifact.id, "community.mock-app");
  assert.equal(Array.isArray(environment.host.events), true);
});

test("buildArtifact extracts datapack dependencies from a single-entry component app", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crafter8-sdk-component-app-"));
  const appDir = path.join(tempDir, "app");
  const srcDir = path.join(appDir, "src");
  const pkgDir = path.join(appDir, "node_modules", "@acme", "component-datapack");
  const sdkUrl = sdkEntryUrl;
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(pkgDir, { recursive: true });

  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-component-app",
        version: "1.0.0",
        type: "module",
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(srcDir, "index.mjs"),
    [
      `import { defineApp } from ${JSON.stringify(sdkUrl)};`,
      'import "@acme/component-datapack";',
      "function ProbeComponent() { return null; }",
      'export default defineApp({ id: "community.component-app", name: "Component App", capabilities: ["datapacks.read"], component: ProbeComponent });',
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: "@acme/component-datapack",
        version: "1.2.3",
        type: "module",
        exports: {
          ".": "./index.js",
          "./crafter8": "./crafter8.mjs",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(pkgDir, "index.js"), "export const ok = true;\n");
  fs.writeFileSync(
    path.join(pkgDir, "crafter8.mjs"),
    `import { defineDatapack } from ${JSON.stringify(sdkUrl)};\nexport default defineDatapack({ id: "@acme/component-datapack", name: "Component Datapack", contents: { root: "./data" }, provides: { profile: "test/v1" } });\n`,
  );

  const { manifest } = await buildArtifact({
    entry: path.join(srcDir, "index.mjs"),
    outDir: path.join(tempDir, "dist"),
    specVersion: ARTIFACT_SPEC_V2,
  });

  assert.equal(manifest.kind, "app");
  assert.deepEqual(manifest.dependencies, {
    datapacks: ["@acme/component-datapack"],
  });
});

test("createHostRuntimeApiV1 adapts the current broad host surface", async () => {
  const calls = [];
  const host = {
    version: "1.0.0",
    session() {
      return {
        apiBaseUrl: "https://example.test",
        activeWorkspaceId: "ws-1",
        activeWorkspaceName: "Workspace",
        scenarioIds: "scenario-a",
        capabilities: ["graph.read", "datapacks.read"],
        userId: "leo",
        userDisplayName: "Leo",
        hostApiVersion: "1.0.0",
      };
    },
    hasCapability(capability) {
      return capability === "graph.read";
    },
    assertCapability(capability) {
      if (capability !== "graph.read") {
        throw new Error(`Capability denied: ${capability}`);
      }
    },
    navigateToApp(path) {
      calls.push(["navigateToApp", path]);
    },
    openItemInGraph(itemId) {
      calls.push(["openItemInGraph", itemId]);
    },
    async listDatapacks() {
      return [{ slug: "arc" }];
    },
    async getDatapackManifest(slug) {
      return { slug, manifest: true };
    },
    async listDatapackContents(slug) {
      return { slug, contents: [] };
    },
    async readDatapackContent(slug, key) {
      return { slug, key, content: {} };
    },
    async listModules() {
      return [{ packageName: "@crafter8/graph-utils" }];
    },
    async loadModule(packageName) {
      return { packageName, ok: true };
    },
    async listArtifactOperationCatalog(kind) {
      return [
        {
          kind: kind || "module",
          scope: "public",
          selectors: ["packageName"],
          operations: [{ id: "plan", method: "POST", path: "/api/plan" }],
        },
      ];
    },
    async getArtifactOperations(selector) {
      if (selector.kind !== "module" || selector.packageName !== "@crafter8/planner-core") {
        return null;
      }
      return {
        kind: "module",
        scope: "public",
        selectors: { packageName: "@crafter8/planner-core" },
        resolvedUser: null,
        artifactRef: "artifact.module.planner-core",
        artifact: { packageName: "@crafter8/planner-core" },
        operations: [{ id: "plan", method: "POST", path: "/api/plan" }],
      };
    },
    async fetchJson(path, init) {
      calls.push(["fetchJson", path, init?.method || "GET", init?.body || null]);
      return { ok: true };
    },
  };

  const runtime = createHostRuntimeApiV1(host);

  assert.equal(runtime.version.hostApi, 1);
  assert.equal(runtime.version.hostApiLabel, "1.0.0");
  assert.equal(runtime.session.get().activeWorkspaceId, "ws-1");
  assert.deepEqual(runtime.capabilities.list(), ["graph.read", "datapacks.read"]);
  assert.equal(runtime.capabilities.has("graph.read"), true);
  assert.equal(runtime.capabilities.has("datapacks.read"), false);

  runtime.navigation.navigate("/community/playground");
  runtime.navigation.openItemInGraph("mechanical-components");
  assert.deepEqual(await runtime.datapacks.list(), [{ slug: "arc" }]);
  assert.deepEqual(await runtime.modules.load("@crafter8/graph-utils"), {
    packageName: "@crafter8/graph-utils",
    ok: true,
  });

  const resolved = await runtime.operations.get({
    packageName: "@crafter8/planner-core",
    operationId: "plan",
  });
  assert.equal(resolved?.operation.id, "plan");

  const invoked = await runtime.operations.invoke(
    {
      kind: "module",
      packageName: "@crafter8/planner-core",
      operationId: "plan",
    },
    { body: { target: "alpha" } },
  );
  assert.deepEqual(invoked, { ok: true });
  assert.deepEqual(calls, [
    ["navigateToApp", "/community/playground"],
    ["openItemInGraph", "mechanical-components"],
    ["fetchJson", "/api/plan", "POST", JSON.stringify({ target: "alpha" })],
  ]);
});

test("createEmbeddedCrafter8Client adapts the broad host surface to the canonical client API", async () => {
  const calls = [];
  const assetFetchCalls = [];
  const host = {
    session() {
      return {
        activeWorkspaceId: "ws-1",
        activeWorkspaceName: "Workspace",
        capabilities: ["graph.read", "datapacks.read"],
        userId: "leo",
        userDisplayName: "Leo",
        hostApiVersion: "1.0.0",
      };
    },
    async fetchJson(path, init) {
      calls.push([path, init?.method || "GET"]);
      if (path === "/api/session/v1") {
        return {
          data: {
            session: {
              userId: "leo",
              displayName: "Leo",
              grantedCapabilities: ["graph.read", "datapacks.read"],
              hostApiVersion: "1.0.0",
            },
          },
        };
      }
      if (path === "/api/artifacts?kind=module") {
        return { data: { artifacts: [{ kind: "module", packageName: "@crafter8/graph-utils" }] } };
      }
      if (path === "/api/datapacks") {
        return { data: { datapacks: [{ slug: "arc" }] } };
      }
      if (path === "/api/datapacks/arc/manifest") {
        return { data: { datapack: { slug: "arc" }, manifest: { slug: "arc", contents: [] } } };
      }
      if (path === "/api/datapacks/arc/contents") {
        return { data: { datapack: { slug: "arc" }, contents: [{ key: "items" }] } };
      }
      if (path === "/api/datapacks/arc/resolve-content?key=items") {
        return {
          data: {
            datapack: { slug: "arc" },
            content: {
              key: "items",
              sourceKind: "published",
              deliveryKind: "static",
              url: "/community-datapacks/arc/1.0.0/items.json",
              cacheKey: "arc:items:123",
              contentType: "application/json",
            },
          },
        };
      }
      if (path === "/api/artifacts/operations?kind=engine&packageName=%40crafter8%2Fresource-graph-core&operationId=read-engine-discovery") {
        return {
          data: {
            resolved: {
              kind: "engine",
              scope: "public",
              selectors: { packageName: "@crafter8/resource-graph-core" },
              resolvedUser: null,
              artifactRef: "artifact.engine.resource-graph-core",
              artifact: { packageName: "@crafter8/resource-graph-core" },
              operations: [{ id: "read-engine-discovery", method: "GET", path: "/api/engines/discovery" }],
            },
          },
        };
      }
      if (path === "/api/engines/discovery") {
        return { data: { engines: [{ packageName: "@crafter8/resource-graph-core" }] } };
      }
      throw new Error(`unexpected path: ${path}`);
    },
  };

  const client = createEmbeddedCrafter8Client(host, {
    assetBaseUrl: "https://crafter8.test",
    assetFetch: async (url) => {
      assetFetchCalls.push(url);
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return String(name || "").toLowerCase() === "content-type" ? "application/json" : null;
          },
        },
        async json() {
          return { ok: true };
        },
        async text() {
          throw new Error("text() should not be called for JSON assets");
        },
        async arrayBuffer() {
          throw new Error("arrayBuffer() should not be called for JSON assets");
        },
      };
    },
  });

  const session = await client.session.get();
  assert.equal(session.userId, "leo");
  assert.equal(session.hostApi, 1);

  const artifacts = await client.artifacts.list({ kind: "module" });
  assert.equal(artifacts.length, 1);

  const datapacks = await client.datapacks.list();
  assert.deepEqual(datapacks, [{ slug: "arc" }]);
  const resolvedContent = await client.datapacks.resolveContent("arc", "items");
  assert.equal(resolvedContent.sourceKind, "published");
  assert.equal(resolvedContent.url, "/community-datapacks/arc/1.0.0/items.json");
  assert.deepEqual(resolvedContent.datapack, {
    kind: "datapack",
    id: "arc",
    slug: "arc",
  });
  assert.deepEqual(resolvedContent.warnings, []);
  const content = await client.datapacks.readContent("arc", "items");
  assert.deepEqual(content, { ok: true });

  const operation = await client.operations.get({
    kind: "engine",
    packageName: "@crafter8/resource-graph-core",
    operationId: "read-engine-discovery",
  });
  assert.equal(operation?.operation.id, "read-engine-discovery");
  const invoked = await client.operations.invoke({
    kind: "engine",
    packageName: "@crafter8/resource-graph-core",
    operationId: "read-engine-discovery",
  });
  assert.deepEqual(invoked, { engines: [{ packageName: "@crafter8/resource-graph-core" }] });
  assert.deepEqual(calls, [
    ["/api/session/v1", "GET"],
    ["/api/artifacts?kind=module", "GET"],
    ["/api/datapacks", "GET"],
    ["/api/datapacks/arc/resolve-content?key=items", "GET"],
    ["/api/datapacks/arc/resolve-content?key=items", "GET"],
    ["/api/artifacts/operations?kind=engine&packageName=%40crafter8%2Fresource-graph-core&operationId=read-engine-discovery", "GET"],
    ["/api/artifacts/operations?kind=engine&packageName=%40crafter8%2Fresource-graph-core&operationId=read-engine-discovery", "GET"],
    ["/api/engines/discovery", "GET"],
  ]);
  assert.deepEqual(assetFetchCalls, ["https://crafter8.test/community-datapacks/arc/1.0.0/items.json"]);
});

test("createCrafter8Client resolves local datapack sources before published content in local-first mode", async () => {
  const calls = [];
  const client = createCrafter8Client({
    transport: {
      async request(request) {
        calls.push(request.path);
        throw new Error(`unexpected remote request: ${request.path}`);
      },
    },
    datapacks: {
      mode: "local-first",
      localResolver({ datapack, key }) {
        assert.equal(datapack.packageName, "@crafter8/metaforge--arcraiders-data");
        assert.equal(key, "items");
        return {
          packageName: datapack.packageName,
          version: "workspace",
          value: { source: "local", ok: true },
          contentType: "application/json",
        };
      },
    },
  });

  const datapack = createDatapackRef("@crafter8/metaforge--arcraiders-data");
  const resolved = await client.datapacks.resolveContent(datapack, "items");
  assert.equal(resolved.sourceKind, "local");
  assert.equal(resolved.datapack.packageName, "@crafter8/metaforge--arcraiders-data");
  assert.equal(resolved.datapack.version, "workspace");
  assert.equal(resolved.url, "local://%40crafter8%2Fmetaforge--arcraiders-data/items");
  assert.deepEqual(resolved.warnings, []);
  assert.deepEqual(await client.datapacks.readContent(datapack, "items"), {
    source: "local",
    ok: true,
  });
  assert.deepEqual(calls, []);
});

test("createCrafter8Client falls back when a datapack is not published and records a warning", async () => {
  const calls = [];
  const client = createCrafter8Client({
    transport: {
      async request(request) {
        const query = request.query ? `?${new URLSearchParams(request.query).toString()}` : "";
        calls.push(`${request.path}${query}`);
        throw new Error("not published");
      },
    },
    datapacks: {
      mode: "remote-first",
      fallbackResolver({ datapack, key }) {
        assert.equal(datapack.packageName, "@crafter8/metaforge--arcraiders-data");
        assert.equal(key, "items");
        return {
          packageName: datapack.packageName,
          version: "fallback",
          url: "https://example.test/fallback/items.json",
          value: { source: "fallback", ok: true },
          warnings: ["Using bundled datapack asset."],
        };
      },
    },
  });

  const datapack = createDatapackRef("@crafter8/metaforge--arcraiders-data");
  const resolved = await client.datapacks.resolveContent(datapack, "items");
  assert.equal(resolved.sourceKind, "fallback");
  assert.equal(resolved.url, "https://example.test/fallback/items.json");
  assert.deepEqual(resolved.warnings, [
    'Datapack "@crafter8/metaforge--arcraiders-data" is not published in Crafter8. Using fallback distribution for content "items".',
    "Using bundled datapack asset.",
  ]);
  assert.deepEqual(await client.datapacks.readContent(datapack, "items"), {
    source: "fallback",
    ok: true,
  });
  assert.deepEqual(calls, [
    "/api/artifacts?kind=datapack&packageName=%40crafter8%2Fmetaforge--arcraiders-data",
    "/api/artifacts?kind=datapack&packageName=%40crafter8%2Fmetaforge--arcraiders-data",
  ]);
});

test("createCrafter8Client reads session from /api/session/v1 when no local resolver is configured", async () => {
  const calls = [];
  const client = createCrafter8Client({
    transport: {
      async request(request) {
        const query = request.query ? `?${new URLSearchParams(request.query).toString()}` : "";
        calls.push(`${request.path}${query}`);
        if (request.path === "/api/session/v1") {
          return {
            data: {
              session: {
                authenticated: true,
                userId: "leo",
                displayName: "Leo",
                hostApiVersion: "1.0.0",
                grantedCapabilities: ["graph.read"],
              },
            },
          };
        }
        throw new Error(`unexpected path: ${request.path}`);
      },
    },
  });

  const session = await client.session.get();
  assert.deepEqual(session, {
    authenticated: true,
    userId: "leo",
    userDisplayName: "Leo",
    activeWorkspaceId: null,
    activeWorkspaceName: null,
    capabilities: ["graph.read"],
    hostApi: 1,
    hostApiLabel: "1.0.0",
  });
  assert.deepEqual(calls, ["/api/session/v1"]);
});

test("registered datapack package sources enable zero-config local and fallback resolution", async () => {
  const datapack = createDatapackRef({
    id: "@crafter8/test-registered-datapack",
    packageName: "@crafter8/test-registered-datapack",
    slug: "test-registered-datapack",
  });

  registerDatapackPackageSource(datapack, {
    local({ key }) {
      return key === "manifest" ? { value: { source: "local", key } } : null;
    },
    fallback({ key }) {
      return key === "manifest" ? { value: { source: "fallback", key } } : null;
    },
  });

  const localClient = createCrafter8Client({
    transport: {
      async request(request) {
        throw new Error(`unexpected request in local mode: ${request.path}`);
      },
    },
    datapacks: {
      mode: "local-first",
    },
  });

  const localResolved = await localClient.datapacks.resolveContent(datapack, "manifest");
  assert.equal(localResolved.sourceKind, "local");
  assert.deepEqual(await localClient.datapacks.readContent(datapack, "manifest"), {
    source: "local",
    key: "manifest",
  });

  const fallbackClient = createCrafter8Client({
    transport: {
      async request() {
        throw new Error("not published");
      },
    },
    datapacks: {
      mode: "remote-first",
    },
  });

  const fallbackResolved = await fallbackClient.datapacks.resolveContent(datapack, "manifest");
  assert.equal(fallbackResolved.sourceKind, "fallback");
  assert.deepEqual(await fallbackClient.datapacks.readContent(datapack, "manifest"), {
    source: "fallback",
    key: "manifest",
  });
});

test("createCrafter8HostServices exposes shell navigation only", () => {
  const calls = [];
  const services = createCrafter8HostServices({
    navigateToApp(path) {
      calls.push(["navigateToApp", path]);
    },
    openItemInGraph(itemId) {
      calls.push(["openItemInGraph", itemId]);
    },
  });

  services.navigation.navigate("/community/playground");
  services.navigation.openItemInGraph("mechanical-components");

  assert.deepEqual(calls, [
    ["navigateToApp", "/community/playground"],
    ["openItemInGraph", "mechanical-components"],
  ]);
});

test("createEmbeddedCrafter8Environment exposes client and host services, with optional legacy runtime", () => {
  const host = {
    version: "1.0.0",
    session() {
      return {
        apiBaseUrl: "https://example.test",
        activeWorkspaceId: "ws-1",
        activeWorkspaceName: "Workspace",
        scenarioIds: "scenario-a",
        capabilities: ["graph.read"],
        hostApiVersion: "1.0.0",
      };
    },
    hasCapability(capability) {
      return capability === "graph.read";
    },
    assertCapability() {},
    navigateToApp() {},
    openItemInGraph() {},
    async listDatapacks() {
      return [];
    },
    async getDatapackManifest() {
      return {};
    },
    async listDatapackContents() {
      return {};
    },
    async readDatapackContent() {
      return {};
    },
    async listModules() {
      return [];
    },
    async loadModule() {
      return {};
    },
    async listArtifactOperationCatalog() {
      return [];
    },
    async getArtifactOperations() {
      return null;
    },
    async fetchJson() {
      return {};
    },
  };

  const environment = createEmbeddedCrafter8Environment(host, {
    includeLegacyRuntime: true,
  });

  assert.equal(typeof environment.client.session.get, "function");
  assert.equal(typeof environment.host.navigation.navigate, "function");
  assert.equal(environment.runtime?.version.hostApi, 1);
});

test("createAppContext wraps host runtime and artifact metadata", () => {
  const host = {
    version: "1.0.0",
    session() {
      return {
        apiBaseUrl: "https://example.test",
        activeWorkspaceId: "ws-1",
        activeWorkspaceName: "Workspace",
        scenarioIds: "scenario-a",
        capabilities: ["graph.read"],
        hostApiVersion: "1.0.0",
      };
    },
    hasCapability() {
      return true;
    },
    assertCapability() {},
    navigateToApp() {},
    openItemInGraph() {},
    async listDatapacks() {
      return [];
    },
    async getDatapackManifest() {
      return {};
    },
    async listDatapackContents() {
      return {};
    },
    async readDatapackContent() {
      return {};
    },
    async listModules() {
      return [];
    },
    async loadModule() {
      return {};
    },
    async listArtifactOperationCatalog() {
      return [];
    },
    async getArtifactOperations() {
      return null;
    },
    async fetchJson() {
      return {};
    },
  };

  const appContext = createAppContext({
    host,
    container: { nodeType: 1 },
    artifact: {
      id: "@leo/stash-browser",
      version: "1.0.0",
      name: "Stash Browser",
      summary: "Explore stash paths",
      capabilities: ["graph.read"],
      dependencies: {
        datapacks: ["@acme/test-datapack"],
      },
    },
  });

  assert.equal(appContext.artifact.kind, "app");
  assert.equal(appContext.artifact.id, "@leo/stash-browser");
  assert.deepEqual(appContext.artifact.dependencies, {
    datapacks: ["@acme/test-datapack"],
  });
  assert.equal(typeof appContext.client.session.get, "function");
  assert.equal(typeof appContext.host?.navigation.navigate, "function");
  assert.equal(appContext.runtime?.version.hostApi, 1);
});

test("createCrafter8ReactBindings exposes provider and hooks over appContext", () => {
  const fakeReact = {
    createContext(defaultValue) {
      const context = { current: defaultValue };
      context.Provider = { __provider: true, context };
      return context;
    },
    createElement(type, props, ...children) {
      if (type?.__provider) {
        type.context.current = props.value;
      }
      return {
        type,
        props: {
          ...(props || {}),
          children,
        },
      };
    },
    useContext(context) {
      return context.current;
    },
    useMemo(factory) {
      return factory();
    },
  };

  const { Crafter8Provider, useCrafter8, useCrafter8Client, useCrafter8Artifact } =
    createCrafter8ReactBindings(fakeReact);

  const appContext = createAppContext({
    client: createCrafter8Client({
      transport: {
        async request() {
          return { data: {} };
        },
      },
    }),
    container: { nodeType: 1 },
    artifact: {
      id: "community.provider-probe",
      version: "1.0.0",
      name: "Provider Probe",
    },
  });

  const rendered = Crafter8Provider({
    appContext,
    children: "child",
  });

  assert.equal(rendered.props.value.appContext, appContext);
  assert.equal(useCrafter8().appContext, appContext);
  assert.equal(useCrafter8Client(), appContext.client);
  assert.equal(useCrafter8Artifact().id, "community.provider-probe");
});

test("createCrafter8ReactBindings caches bindings per React instance", () => {
  const reactLike = {
    createContext(defaultValue) {
      return {
        current: defaultValue,
        Provider({ value, children }) {
          return { value, children };
        },
      };
    },
    createElement(type, props, ...children) {
      return { type, props, children };
    },
    useContext(context) {
      return context.current;
    },
    useMemo(factory) {
      return factory();
    },
  };

  const first = createCrafter8ReactBindings(reactLike);
  const second = createCrafter8ReactBindings(reactLike);

  assert.equal(first, second);
});
