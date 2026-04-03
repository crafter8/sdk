import type { AppContext, Crafter8Client, Crafter8HostServices, HostRuntimeApiV1 } from "./index.js";

export type Crafter8ContextValue = {
  appContext: AppContext;
  client: Crafter8Client;
  host?: Crafter8HostServices;
  runtime?: HostRuntimeApiV1;
  artifact: AppContext["artifact"];
};

export type Crafter8ReactLike = {
  createContext(defaultValue: null): unknown;
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useContext(context: unknown): unknown;
  useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
};

export declare function createCrafter8ReactBindings(React: Crafter8ReactLike): {
  Crafter8Provider(props: {
    appContext?: AppContext;
    value?: Crafter8ContextValue | AppContext;
    children?: unknown;
  }): unknown;
  useCrafter8(): Crafter8ContextValue;
  useCrafter8AppContext(): AppContext;
  useCrafter8Client(): Crafter8Client;
  useCrafter8Host(): Crafter8HostServices | undefined;
  useCrafter8Artifact(): AppContext["artifact"];
  useCrafter8Runtime(): HostRuntimeApiV1 | undefined;
};
