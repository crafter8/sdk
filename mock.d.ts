import type {
  ArtifactMetaBase,
  Crafter8Client,
  Crafter8DatapackClientOptions,
  Crafter8HostServices,
  Crafter8Session,
  Crafter8Transport,
  AppContext,
  ModuleContext,
  RuntimeOperationDescriptor,
} from "./index.js";

export type MockArtifactRecord = Record<string, unknown> & {
  kind: string;
  packageName?: string;
  slug?: string;
  id?: string;
  name?: string;
  description?: string;
  summary?: string;
  trustLevel?: string;
  user?: string;
};

export type MockDatapackRecord = {
  packageName?: string;
  slug?: string;
  id?: string;
  version?: string;
  name?: string;
  description?: string;
  summary?: string;
  capability?: string;
  profile?: string;
  manifest?: Record<string, unknown>;
  contents?: Array<{
    key: string;
    label?: string;
    kind?: "file" | "dir";
    path?: string;
    role?: string | null;
    contentType?: string | null;
  }>;
  contentValues?: Record<string, unknown>;
};

export type MockOperationRecord = {
  kind?: string;
  scope?: string;
  selectors?: Record<string, unknown>;
  artifactRef?: string | null;
  artifact?: Record<string, unknown> | null;
  operation?: Record<string, unknown> & {
    id: string;
    method?: string;
    path?: string;
  };
  result?: unknown;
  invoke?: (input: {
    method: string;
    path: string;
    query: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
    selector: Record<string, unknown>;
    artifact: Record<string, unknown> | null;
    operation: Record<string, unknown>;
  }) => Promise<unknown> | unknown;
};

export type MockCrafter8ClientOptions = {
  session?: Partial<Crafter8Session>;
  artifacts?: MockArtifactRecord[];
  datapacks?: MockDatapackRecord[];
  operations?: MockOperationRecord[];
  datapacksOptions?: Crafter8DatapackClientOptions;
};

export type MockCrafter8HostServices = Crafter8HostServices & {
  events: Array<
    | { type: "navigate"; path: string }
    | { type: "openItemInGraph"; itemId: string }
  >;
};

export type MockCrafter8Environment = {
  client: Crafter8Client;
  host: MockCrafter8HostServices;
  appContext: AppContext;
};

export function createMockCrafter8Transport(options?: MockCrafter8ClientOptions): Crafter8Transport;

export function createMockCrafter8Client(options?: MockCrafter8ClientOptions): Crafter8Client;

export function createMockCrafter8HostServices(options?: {
  navigate?: (path: string) => unknown;
  openItemInGraph?: (itemId: string) => unknown;
}): MockCrafter8HostServices;

export function createMockAppContext(options?: MockCrafter8ClientOptions & {
  client?: Crafter8Client;
  host?: MockCrafter8HostServices;
  hostServices?: MockCrafter8HostServices;
  hostOptions?: {
    navigate?: (path: string) => unknown;
    openItemInGraph?: (itemId: string) => unknown;
  };
  artifact?: Partial<ArtifactMetaBase<"app">> & { id?: string; version?: string };
  container?: unknown;
}): AppContext;

export function createMockModuleContext(options?: MockCrafter8ClientOptions & {
  client?: Crafter8Client;
  artifact?: Partial<ArtifactMetaBase<"module">> & { id?: string; version?: string };
}): ModuleContext;

export function createMockCrafter8Environment(options?: MockCrafter8ClientOptions & {
  client?: Crafter8Client;
  host?: MockCrafter8HostServices;
  hostServices?: MockCrafter8HostServices;
  hostOptions?: {
    navigate?: (path: string) => unknown;
    openItemInGraph?: (itemId: string) => unknown;
  };
  artifact?: Partial<ArtifactMetaBase<"app">> & { id?: string; version?: string };
  container?: unknown;
}): MockCrafter8Environment;
