function readRuntimeConfig(globalObject = globalThis) {
  const runtimeConfig = globalObject?.__LLI_RUNTIME_CONFIG__;
  if (!runtimeConfig || typeof runtimeConfig !== "object") {
    return {};
  }

  return runtimeConfig;
}

function resolveServiceBaseUrl(key, options = {}) {
  const runtimeConfig = options.runtimeConfig ?? readRuntimeConfig(options.globalObject);
  const viteEnv = options.viteEnv ?? import.meta.env;
  const isDev = options.isDev ?? Boolean(viteEnv?.DEV);

  const runtimeValue = runtimeConfig[key];
  if (typeof runtimeValue === "string" && runtimeValue.trim() !== "") {
    return runtimeValue.trim();
  }

  if (isDev) {
    const devFallbacks = {
      crmAdapterBaseUrl: viteEnv?.VITE_CRM_ADAPTER_BASE_URL ?? "http://localhost:3000",
      leadEngineBaseUrl: viteEnv?.VITE_LEAD_ENGINE_BASE_URL ?? "http://localhost:8000",
    };
    const devValue = devFallbacks[key];
    return typeof devValue === "string" ? devValue.trim() : "";
  }

  return "";
}

function getRequiredServiceBaseUrl(key) {
  const baseUrl = resolveServiceBaseUrl(key);
  if (baseUrl) {
    return baseUrl;
  }

  const serviceLabels = {
    crmAdapterBaseUrl: "CRM adapter",
    leadEngineBaseUrl: "lead engine",
  };

  throw new Error(
    `${serviceLabels[key] ?? "Service"} base URL is not configured for production runtime config`,
  );
}

export { getRequiredServiceBaseUrl, readRuntimeConfig, resolveServiceBaseUrl };
