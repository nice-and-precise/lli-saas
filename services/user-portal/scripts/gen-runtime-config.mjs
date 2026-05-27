// Generates dist/runtime-config.js at build time, mirroring what the Docker
// entrypoint used to inject at container start. index.html loads
// /runtime-config.js, which sets window.__LLI_RUNTIME_CONFIG__ — the values the
// app reads in production (it intentionally ignores VITE_* outside dev).
//
// Kept as a build step (not a committed static file) so local `npm run dev`,
// which has no runtime-config.js, still falls back to localhost.
import { mkdirSync, writeFileSync } from "node:fs";

const config = {
  crmAdapterBaseUrl:
    process.env.VITE_CRM_ADAPTER_BASE_URL || process.env.CRM_ADAPTER_BASE_URL || "",
  leadEngineBaseUrl:
    process.env.VITE_LEAD_ENGINE_BASE_URL || process.env.LEAD_ENGINE_BASE_URL || "",
};

mkdirSync("dist", { recursive: true });
writeFileSync(
  "dist/runtime-config.js",
  `window.__LLI_RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`,
);
console.log("wrote dist/runtime-config.js:", config);
