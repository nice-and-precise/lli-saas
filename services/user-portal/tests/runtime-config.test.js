import { describe, expect, it } from "vitest";

import { resolveServiceBaseUrl } from "../src/runtimeConfig";

describe("runtime config helpers", () => {
  it("prefers runtime config over Vite values", () => {
    expect(
      resolveServiceBaseUrl("crmAdapterBaseUrl", {
        runtimeConfig: {
          crmAdapterBaseUrl: "https://crm-adapter.example.com",
        },
        viteEnv: {
          DEV: false,
          VITE_CRM_ADAPTER_BASE_URL: "http://localhost:3000",
        },
        isDev: false,
      }),
    ).toBe("https://crm-adapter.example.com");
  });

  it("does not fall back to localhost in production", () => {
    expect(
      resolveServiceBaseUrl("leadEngineBaseUrl", {
        runtimeConfig: {},
        viteEnv: {
          DEV: false,
          VITE_LEAD_ENGINE_BASE_URL: "http://localhost:8000",
        },
        isDev: false,
      }),
    ).toBe("");
  });
});
