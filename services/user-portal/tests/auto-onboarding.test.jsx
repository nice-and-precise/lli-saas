import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import App from "../src/App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete globalThis.__LLI_RUNTIME_CONFIG__;
});

const json = (body) => ({ ok: true, json: async () => body });

test("auto-onboards on first connected load: provisions once, then renders the set-up board", async () => {
  globalThis.__LLI_RUNTIME_CONFIG__ = {
    crmAdapterBaseUrl: "https://crm.example.com",
    leadEngineBaseUrl: "https://lead.example.com",
  };

  let provisionCalls = 0;
  const unprovisioned = {
    tenant_id: "pilot",
    token_present: true,
    onboarding: { auto_provisioned_at: null },
    board: null,
    source_board: null,
    deliveries: [],
    scan_runs: [],
    latest_delivery: null,
  };
  const provisioned = {
    ...unprovisioned,
    onboarding: { auto_provisioned_at: "2026-05-27T12:00:00Z", destination_provisioned: true },
    board: { id: "lll-1", name: "Land Legacy Leads", columns: [] },
    source_board: { id: "clients-1", name: "Clients" },
  };

  // Route by URL + method so the assertion doesn't depend on call ordering.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
    const u = String(url);
    const method = options.method ?? "GET";
    if (u.endsWith("/onboard/auto-provision") && method === "POST") {
      provisionCalls += 1;
      return json({ auto_provisioned: true });
    }
    if (u.endsWith("/status")) return json(provisionCalls > 0 ? provisioned : unprovisioned);
    if (u.endsWith("/mapping")) return json({ mapping: { item_name_strategy: "deceased_name_county", columns: {} }, field_catalog: { crm_fields: [], lli_fields: [] } });
    if (u.endsWith("/boards")) return json({ boards: [], selected_board: provisionCalls > 0 ? provisioned.board : null });
    if (u.endsWith("/validation")) return json({ capabilities: { token_present: true }, issues: [], suggestions: [], summary: { error_count: 0, warning_count: 0, info_count: 0 } });
    if (u.endsWith("/metrics")) return json({ daily: [], totals: { days_tracked: 0, obituaries: 0, leads_delivered: 0 } });
    return json({});
  });

  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <App />
    </MemoryRouter>,
  );

  // The auto-provision endpoint is hit exactly once, then the reload shows the
  // auto-created destination board.
  await waitFor(() => expect(provisionCalls).toBe(1));
  await waitFor(() => expect(screen.getAllByText(/Land Legacy Leads/i).length).toBeGreaterThan(0));
});

test("does not auto-provision when already provisioned", async () => {
  globalThis.__LLI_RUNTIME_CONFIG__ = {
    crmAdapterBaseUrl: "https://crm.example.com",
    leadEngineBaseUrl: "https://lead.example.com",
  };

  let provisionCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith("/onboard/auto-provision") && (options.method ?? "GET") === "POST") {
      provisionCalls += 1;
      return json({ auto_provisioned: true });
    }
    if (u.endsWith("/status")) {
      return json({
        tenant_id: "pilot",
        token_present: true,
        onboarding: { auto_provisioned_at: "2026-05-27T12:00:00Z" },
        board: { id: "lll-1", name: "Land Legacy Leads", columns: [] },
        source_board: { id: "clients-1", name: "Clients" },
        deliveries: [],
        scan_runs: [],
        latest_delivery: null,
      });
    }
    if (u.endsWith("/mapping")) return json({ mapping: { item_name_strategy: "deceased_name_county", columns: {} }, field_catalog: { crm_fields: [], lli_fields: [] } });
    if (u.endsWith("/boards")) return json({ boards: [], selected_board: { id: "lll-1", name: "Land Legacy Leads" } });
    if (u.endsWith("/validation")) return json({ capabilities: { token_present: true }, issues: [], suggestions: [], summary: { error_count: 0, warning_count: 0, info_count: 0 } });
    if (u.endsWith("/metrics")) return json({ daily: [], totals: {} });
    return json({});
  });

  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <App />
    </MemoryRouter>,
  );

  await waitFor(() => expect(screen.getByRole("heading", { name: /obituary intelligence cockpit/i })).toBeInTheDocument());
  // Marker already set → the portal must not fire the provision endpoint.
  expect(provisionCalls).toBe(0);
});
