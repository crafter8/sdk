export type ArtifactKind = "app" | "module" | "datapack";

export type ArtifactRef<K extends ArtifactKind = ArtifactKind> = {
  kind: K;
  id: string;
  packageName?: string;
  slug?: string;
  version?: string;
};

export type ArtifactMetaBase<K extends ArtifactKind = ArtifactKind> = {
  kind: K;
  id: string;
  version: string;
  name?: string;
  summary?: string;
  capabilities?: string[];
  /**
   * @deprecated Transitional metadata only.
   * Prefer generated `dependencies` as the primary dependency graph.
   */
  uses?: {
    modules?: string[];
    datapacks?: string[];
  };
  provides?: Record<string, unknown>;
  dependencies?: {
    modules?: string[];
    datapacks?: string[];
  };
};

/**
 * @deprecated Transitional creator input.
 * Prefer package imports and generated `dependencies`.
 */
export type UsesBlock = {
  modules?: Array<ArtifactRef<"module"> | string>;
  datapacks?: Array<ArtifactRef<"datapack"> | string>;
};

export type Crafter8Session = {
  authenticated: boolean;
  userId: string | null;
  userDisplayName: string | null;
  activeWorkspaceId: string | null;
  activeWorkspaceName: string | null;
  capabilities: string[];
  hostApi: number;
  hostApiLabel: string;
};

export type Crafter8TransportRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
};

export type Crafter8Transport = {
  request<T = unknown>(request: Crafter8TransportRequest): Promise<T>;
};

export type Crafter8AuthProvider = {
  getHeaders(): Promise<Record<string, string>>;
};

export type Crafter8AssetFetch = typeof fetch;

export type Crafter8PublicHttpTransportOptions = {
  baseUrl: string;
  auth?: Crafter8AuthProvider;
  fetchImpl?: typeof fetch;
};

export type ResolvedDatapackContent = {
  sourceKind: "published" | "local" | "fallback";
  datapack: ArtifactRef<"datapack">;
  key: string;
  url: string;
  contentType: string;
  cacheKey: string;
  integrity?: string;
  encoding?: string;
  requiresAuth: boolean;
  expiresAt?: string | null;
  warnings: string[];
};

export type DatapackSelector = string | ArtifactRef<"datapack"> | DatapackDefinition;

export type Crafter8DatapackResolverMode = "local-first" | "remote-first";

export type Crafter8DatapackSourceCandidate = {
  url?: string;
  contentType?: string;
  cacheKey?: string;
  integrity?: string;
  encoding?: string;
  requiresAuth?: boolean;
  expiresAt?: string | null;
  value?: unknown;
  read?: () => Promise<unknown> | unknown;
  warnings?: string | string[];
  packageName?: string;
  slug?: string;
  version?: string;
};

export type Crafter8DatapackResolver = (input: {
  datapack: ArtifactRef<"datapack">;
  key: string;
}) => Promise<Crafter8DatapackSourceCandidate | null> | Crafter8DatapackSourceCandidate | null;

export type Crafter8DatapackPackageSource = {
  local?: Crafter8DatapackResolver | Crafter8DatapackSourceCandidate | null;
  fallback?: Crafter8DatapackResolver | Crafter8DatapackSourceCandidate | null;
};

export type Crafter8DatapackClientOptions = {
  mode?: Crafter8DatapackResolverMode;
  localResolver?: Crafter8DatapackResolver;
  fallbackResolver?: Crafter8DatapackResolver;
};

export type HostRuntimeVersion = {
  hostApi: number;
  hostApiLabel: string;
};

export type HostRuntimeSession = {
  apiBaseUrl: string;
  activeWorkspaceId: string;
  activeWorkspaceName: string | null;
  scenarioIds: string;
  userId?: string;
  userDisplayName?: string | null;
  capabilities: string[];
  hostApi: number;
  hostApiLabel: string;
};

export type RuntimeOperationSelector = {
  kind?: string;
  packageName?: string;
  slug?: string;
  id?: string;
  user?: string;
  operationId?: string;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, unknown>;
  body?: unknown;
};

export type RuntimeOperationDescriptor = {
  kind: string;
  scope: string;
  selectors: unknown;
  resolvedUser: string | null;
  artifactRef: string | null;
  artifact: Record<string, unknown> | null;
  operation: Record<string, unknown>;
};

export type Crafter8Client = {
  session: {
    get(): Promise<Crafter8Session>;
  };
  artifacts: {
    list(selector?: {
      kind?: "app" | "module" | "datapack";
      trustLevel?: string;
      packageName?: string;
      slug?: string;
      query?: string;
      user?: string;
      id?: string;
    }): Promise<Record<string, unknown>[]>;
    get(selector?: {
      kind?: "app" | "module" | "datapack";
      trustLevel?: string;
      packageName?: string;
      slug?: string;
      query?: string;
      user?: string;
      id?: string;
    }): Promise<Record<string, unknown> | null>;
  };
  datapacks: {
    list(): Promise<unknown[]>;
    getManifest(slug: string): Promise<unknown>;
    listContents(slug: string): Promise<unknown>;
    resolveContent(datapack: DatapackSelector, key: string): Promise<ResolvedDatapackContent>;
    readContent(datapack: DatapackSelector, key: string): Promise<unknown>;
  };
  operations: {
    list(selector?: RuntimeOperationSelector): Promise<RuntimeOperationDescriptor[]>;
    get(selector: RuntimeOperationSelector): Promise<RuntimeOperationDescriptor | null>;
    invoke<TInput = unknown, TOutput = unknown>(
      selector: RuntimeOperationSelector,
      input?: TInput
    ): Promise<TOutput>;
  };
};

export type Crafter8HostServices = {
  navigation: {
    navigate(path: string): void;
    openItemInGraph(itemId: string): void;
  };
};

/**
 * @deprecated Transitional embedded adapter surface.
 * Prefer Crafter8Client for data/compute and Crafter8HostServices for shell integration.
 */
export type HostRuntimeApiV1 = {
  version: HostRuntimeVersion;
  session: {
    get(): HostRuntimeSession;
  };
  capabilities: {
    list(): string[];
    has(capability: string): boolean;
    assert(capability: string): void;
  };
  navigation: {
    navigate(path: string): void;
    openItemInGraph(itemId: string): void;
  };
  datapacks: {
    list(): Promise<unknown[]>;
    getManifest(slug: string): Promise<unknown>;
    listContents(slug: string): Promise<unknown>;
    readContent(slug: string, key: string): Promise<unknown>;
  };
  /**
   * @deprecated Prefer package imports for module code reuse and client.artifacts/client.operations for runtime discovery and compute.
   */
  modules: {
    list(): Promise<unknown[]>;
    load<T extends Record<string, unknown> = Record<string, unknown>>(packageName: string): Promise<T>;
  };
  operations: {
    list(selector?: RuntimeOperationSelector): Promise<RuntimeOperationDescriptor[]>;
    get(selector: RuntimeOperationSelector): Promise<RuntimeOperationDescriptor | null>;
    invoke<TInput = unknown, TOutput = unknown>(
      selector: RuntimeOperationSelector,
      input?: TInput
    ): Promise<TOutput>;
  };
};

export type AppContext = {
  client: Crafter8Client;
  host?: Crafter8HostServices;
  /**
   * @deprecated Transitional embedded adapter surface.
   * Prefer client + host.
   */
  runtime?: HostRuntimeApiV1;
  container: Record<string, unknown>;
  artifact: ArtifactMetaBase<"app">;
};

export type ModuleContext = {
  client: Crafter8Client;
  /**
   * @deprecated Transitional embedded adapter surface.
   * Prefer client and operation-specific context.
   */
  runtime?: HostRuntimeApiV1;
  artifact: ArtifactMetaBase<"module">;
};

export type Crafter8EmbeddedEnvironment = {
  client: Crafter8Client;
  host: Crafter8HostServices;
  runtime?: HostRuntimeApiV1;
};

export type AppDefinition = {
  readonly kind: "app";
  readonly id: string;
  readonly name: string;
  readonly summary?: string;
  readonly capabilities: string[];
  /**
   * @deprecated Transitional metadata only.
   * Prefer package imports and generated `dependencies`.
   */
  readonly uses: {
    modules: string[];
    datapacks: string[];
  };
  readonly mount?: (ctx: AppContext) => unknown;
  readonly component?: (...args: any[]) => any;
};

export type ModuleDefinition = {
  readonly kind: "module";
  readonly id: string;
  readonly name: string;
  readonly summary?: string;
  readonly capabilities: string[];
  /**
   * @deprecated Transitional metadata only.
   * Prefer package imports and generated `dependencies`.
   */
  readonly uses: {
    modules: string[];
    datapacks: string[];
  };
  readonly provides: {
    exports: Record<string, (...args: any[]) => any>;
    operations: string[];
  };
};

export type DatapackDefinition = {
  readonly kind: "datapack";
  readonly id: string;
  readonly name: string;
  readonly summary?: string;
  readonly contents: {
    root?: string;
    manifest?: string;
  };
  readonly provides: {
    profile?: string;
  };
};

export type ArtifactDefinition = AppDefinition | ModuleDefinition | DatapackDefinition;

export type GenerateArtifactManifestOptions = {
  version: string;
  specVersion?: number;
  hostApi?: number;
  /**
   * When true, include legacy `uses` in generated manifests.
   * Default behavior is to emit only `dependencies`.
   */
  legacyUses?: boolean;
  dependencies?: {
    modules?: Array<ArtifactRef<"module"> | string>;
    datapacks?: Array<ArtifactRef<"datapack"> | string>;
  };
};

export declare const ARTIFACT_SPEC_V1: 1;
export declare const ARTIFACT_SPEC_V2: 2;
export declare const HOST_API_V1: 1;

export declare function defineApp(config: {
  id: string;
  name: string;
  summary?: string;
  capabilities?: string[];
  /**
   * @deprecated Transitional input.
   * Prefer package imports and generated `dependencies`.
   */
  uses?: UsesBlock;
  mount?: (ctx: AppContext) => unknown;
  component?: (...args: any[]) => any;
}): AppDefinition;

export declare function defineModule(config: {
  id: string;
  name: string;
  summary?: string;
  capabilities?: string[];
  /**
   * @deprecated Transitional input.
   * Prefer package imports and generated `dependencies`.
   */
  uses?: UsesBlock;
  provides?: {
    exports?: Record<string, (...args: any[]) => any>;
    operations?: string[];
  };
  exports?: Record<string, (...args: any[]) => any>;
  operations?: string[];
}): ModuleDefinition;

export declare function defineDatapack(config: {
  id: string;
  name: string;
  summary?: string;
  contents: {
    root?: string;
    manifest?: string;
  };
  provides?: {
    profile?: string;
  };
}): DatapackDefinition;

export declare function createAppRef(value: string | ArtifactRef<"app"> | AppDefinition): ArtifactRef<"app">;
export declare function createModuleRef(value: string | ArtifactRef<"module"> | ModuleDefinition): ArtifactRef<"module">;
export declare function createDatapackRef(value: string | ArtifactRef<"datapack"> | DatapackDefinition): ArtifactRef<"datapack">;
export declare function registerDatapackPackageSource(
  value: DatapackSelector,
  source: Crafter8DatapackPackageSource
): {
  datapack: ArtifactRef<"datapack">;
  local: Crafter8DatapackResolver | null;
  fallback: Crafter8DatapackResolver | null;
};
export declare function getRegisteredDatapackPackageSource(
  value: DatapackSelector
): {
  datapack: ArtifactRef<"datapack">;
  local: Crafter8DatapackResolver | null;
  fallback: Crafter8DatapackResolver | null;
} | null;
export declare function isArtifactDefinition(value: unknown): value is ArtifactDefinition;
export declare function isCrafter8Client(value: unknown): value is Crafter8Client;
export declare function isCrafter8HostServices(value: unknown): value is Crafter8HostServices;
export declare function isHostRuntimeApiV1(value: unknown): value is HostRuntimeApiV1;
export declare function readArtifactRef<K extends ArtifactKind>(value: string | ArtifactRef<K> | ArtifactDefinition, expectedKind: K): ArtifactRef<K>;
export declare function createCrafter8HostServices(host: unknown): Crafter8HostServices;
export declare function createPublicHttpTransport(options: Crafter8PublicHttpTransportOptions): Crafter8Transport;
export declare function createEmbeddedHostTransport(host: unknown): Crafter8Transport;
export declare function createCrafter8Client(args: {
  transport: Crafter8Transport;
  sessionResolver?: () => Promise<unknown> | unknown;
  datapacks?: Crafter8DatapackClientOptions;
  assetFetch?: Crafter8AssetFetch;
  assetBaseUrl?: string;
}): Crafter8Client;
/**
 * Embedded/advanced adapter for creating a Crafter8Client from the current broad host surface.
 * Most apps should receive a configured client from Crafter8 rather than constructing it directly.
 */
export declare function createEmbeddedCrafter8Client(
  host: unknown,
  options?: { datapacks?: Crafter8DatapackClientOptions; assetFetch?: Crafter8AssetFetch; assetBaseUrl?: string }
): Crafter8Client;
export declare function createEmbeddedCrafter8Environment(
  host: unknown,
  options?: {
    datapacks?: Crafter8DatapackClientOptions;
    includeLegacyRuntime?: boolean;
    assetFetch?: Crafter8AssetFetch;
    assetBaseUrl?: string;
  }
): Crafter8EmbeddedEnvironment;
/**
 * @deprecated Transitional embedded adapter surface.
 * Prefer Crafter8Client + Crafter8HostServices.
 */
export declare function createHostRuntimeApiV1(host: unknown): HostRuntimeApiV1;
export declare function createAppContext(args: {
  client?: Crafter8Client;
  host?: HostRuntimeApiV1 | unknown;
  hostServices?: Crafter8HostServices | unknown;
  runtime?: HostRuntimeApiV1 | unknown;
  container: Record<string, unknown>;
  artifact: Omit<ArtifactMetaBase<"app">, "kind"> & { kind?: "app" };
}): AppContext;
export declare function createModuleContext(args: {
  client?: Crafter8Client;
  host?: HostRuntimeApiV1 | unknown;
  runtime?: HostRuntimeApiV1 | unknown;
  artifact: Omit<ArtifactMetaBase<"module">, "kind"> & { kind?: "module" };
}): ModuleContext;
export declare function generateArtifactManifest(
  definition: ArtifactDefinition,
  options: GenerateArtifactManifestOptions
): Record<string, unknown>;
