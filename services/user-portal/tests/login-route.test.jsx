import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import App from "../src/App";

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.__LLI_RUNTIME_CONFIG__;
});

test("redirects the legacy /login route to the dashboard", () => {
  globalThis.__LLI_RUNTIME_CONFIG__ = {
    crmAdapterBaseUrl: "https://crm-adapter.example.com",
    leadEngineBaseUrl: "https://lead-engine.example.com",
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({}) });

  render(
    <MemoryRouter initialEntries={["/login"]}>
      <App />
    </MemoryRouter>,
  );

  // The dead login stub is gone; /login lands on the dashboard cockpit.
  expect(screen.getByRole("heading", { name: /obituary intelligence cockpit/i })).toBeInTheDocument();
});
