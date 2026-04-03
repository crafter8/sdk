function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isContextValue(value) {
  return (
    isPlainObject(value) &&
    isPlainObject(value.appContext) &&
    isPlainObject(value.client) &&
    isPlainObject(value.artifact)
  );
}

function isAppContextLike(value) {
  return isPlainObject(value) && isPlainObject(value.client) && isPlainObject(value.artifact);
}

function normalizeContextValue(input) {
  const value = isContextValue(input)
    ? input
    : isAppContextLike(input)
      ? {
          appContext: input,
          client: input.client,
          host: input.host,
          runtime: input.runtime,
          artifact: input.artifact,
        }
      : null;

  if (!value) {
    throw new TypeError("Crafter8Provider requires an appContext or Crafter8 context value.");
  }

  if (typeof value.client.session?.get !== "function") {
    throw new TypeError("Crafter8Provider requires a valid Crafter8Client.");
  }

  if (!value.artifact || typeof value.artifact.id !== "string") {
    throw new TypeError("Crafter8Provider requires artifact metadata.");
  }

  return Object.freeze({
    appContext: value.appContext,
    client: value.client,
    ...(value.host ? { host: value.host } : {}),
    ...(value.runtime ? { runtime: value.runtime } : {}),
    artifact: value.artifact,
  });
}

function assertReactLike(reactLike) {
  if (
    !reactLike ||
    typeof reactLike.createContext !== "function" ||
    typeof reactLike.createElement !== "function" ||
    typeof reactLike.useContext !== "function" ||
    typeof reactLike.useMemo !== "function"
  ) {
    throw new TypeError("createCrafter8ReactBindings requires a React-like object.");
  }
}

const REACT_BINDINGS_CACHE = new WeakMap();

export function createCrafter8ReactBindings(React) {
  assertReactLike(React);

  const cached = REACT_BINDINGS_CACHE.get(React);
  if (cached) {
    return cached;
  }

  const Crafter8ReactContext = React.createContext(null);

  function useCrafter8() {
    const context = React.useContext(Crafter8ReactContext);
    if (!context) {
      throw new Error("Crafter8 React context is missing. Wrap the app with <Crafter8Provider>.");
    }
    return context;
  }

  function Crafter8Provider({ appContext, value, children }) {
    const normalizedValue = React.useMemo(
      () => normalizeContextValue(appContext ?? value),
      [appContext, value],
    );

    return React.createElement(Crafter8ReactContext.Provider, { value: normalizedValue }, children);
  }

  function useCrafter8AppContext() {
    return useCrafter8().appContext;
  }

  function useCrafter8Client() {
    return useCrafter8().client;
  }

  function useCrafter8Host() {
    return useCrafter8().host;
  }

  function useCrafter8Artifact() {
    return useCrafter8().artifact;
  }

  function useCrafter8Runtime() {
    return useCrafter8().runtime;
  }

  const bindings = Object.freeze({
    Crafter8Provider,
    useCrafter8,
    useCrafter8AppContext,
    useCrafter8Client,
    useCrafter8Host,
    useCrafter8Artifact,
    useCrafter8Runtime,
  });
  REACT_BINDINGS_CACHE.set(React, bindings);
  return bindings;
}
