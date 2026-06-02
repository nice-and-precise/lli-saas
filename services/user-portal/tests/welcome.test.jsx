import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import App from "../src/App";

const json = (body) => ({ ok: true, json: async () => body });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete globalThis.__LLI_RUNTIME_CONFIG__;
});

test("shows the welcome + expectations panel before Monday is connected", async () => {
  globalThis.__LLI_RUNTIME_CONFIG__ = {
    crmAdapterBaseUrl: "https://crm.example.com",
    leadEngineBaseUrl: "https://lead.example.com",
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = String(url);
    if (u.endsWith("/status"))
      return json({
        tenant_id: "pilot",
        token_present: false,
        onboarding: { auto_provisioned_at: null },
        board: null,
        source_board: null,
        deliveries: [],
        scan_runs: [],
        latest_delivery: null,
      });
    if (u.endsWith("/mapping"))
      return json({ mapping: { item_name_strategy: "deceased_name_county", columns: {} }, field_catalog: { crm_fields: [], lli_fields: [] } });
    if (u.endsWith("/boards")) return json({ boards: [], selected_board: null });
    if (u.endsWith("/validation"))
      return json({ capabilities: { token_present: false }, issues: [], suggestions: [], summary: { error_count: 0, warning_count: 0, info_count: 0 } });
    if (u.endsWith("/metrics")) return json({ daily: [], totals: {} });
    return json({});
  });

  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <App />
    </MemoryRouter>,
  );

  await waitFor(() => expect(screen.getByText(/You'll need/i)).toBeInTheDocument());
  // Sets the Iowa + county/state expectation up front.
  expect(screen.getByText(/works for/i)).toBeInTheDocument();
  expect(screen.getAllByText(/county/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /connect monday/i })).toBeInTheDocument();
});

test("/welcome renders the shareable getting-started page", () => {
  globalThis.__LLI_RUNTIME_CONFIG__ = { crmAdapterBaseUrl: "https://crm.example.com" };

  render(
    <MemoryRouter initialEntries={["/welcome"]}>
      <App />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: /welcome to land legacy leads/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
  expect(screen.getByText(/what to expect/i)).toBeInTheDocument();
});
