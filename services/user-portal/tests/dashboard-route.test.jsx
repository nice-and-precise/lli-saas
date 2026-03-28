import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import App from "../src/App";

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.__LLI_RUNTIME_CONFIG__;
});

test("renders validation status, previews mapping edits, and runs the obituary scan flow", async () => {
  globalThis.__LLI_RUNTIME_CONFIG__ = {
    crmAdapterBaseUrl: "https://crm-adapter.example.com",
    leadEngineBaseUrl: "https://lead-engine.example.com",
  };

  const state = {
    mapping: {
      item_name_strategy: "deceased_name_county",
      columns: {
        deceased_name: "name",
        tier: "status",
      },
    },
    afterScan: false,
  };

  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
    const method = options.method ?? "GET";

    if (url === "https://crm-adapter.example.com/status") {
      if (state.afterScan) {
        return jsonResponse({
          tenant_id: "pilot",
          board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
          deliveries: [{ id: "delivery-2", item_name: "Taylor Example - Boone County", status: "created", scan_id: "scan-2", summary: { tier: "pending_review" } }],
          scan_runs: [{ scan_id: "scan-2", last_delivery_status: "created" }],
          latest_delivery: {
            id: "delivery-2",
            item_name: "Taylor Example - Boone County",
            status: "created",
            scan_id: "scan-2",
            summary: { tier: "pending_review", match_score: 89, heir_count: 1 },
          },
        });
      }

      return jsonResponse({
        tenant_id: "pilot",
        board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
        deliveries: [{ id: "delivery-1", item_name: "Pat Example - Boone County", status: "created", scan_id: "scan-1", summary: { tier: "hot" } }],
        scan_runs: [{ scan_id: "scan-1", last_delivery_status: "created" }],
        latest_delivery: {
          id: "delivery-1",
          item_name: "Pat Example - Boone County",
          status: "created",
          scan_id: "scan-1",
          summary: { tier: "hot", match_score: 96.2, heir_count: 1 },
        },
      });
    }

    if (url === "https://crm-adapter.example.com/mapping" && method === "GET") {
      return jsonResponse({
        tenant_id: "pilot",
        board_id: "board-1",
        mapping: state.mapping,
      });
    }

    if (url === "https://crm-adapter.example.com/boards") {
      return jsonResponse({
        boards: [{ id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] }],
        selected_board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
      });
    }

    if (url === "https://crm-adapter.example.com/validation" && method === "GET") {
      return jsonResponse({
        tenant_id: "pilot",
        preview: false,
        can_start_scan: true,
        summary: { error_count: 0, warning_count: 0, info_count: 0 },
        issues: [],
        suggestions: [],
        state: {
          mapping: {
            mapped_field_count: Object.keys(state.mapping.columns).length,
          },
        },
      });
    }

    if (url === "https://crm-adapter.example.com/validation/preview" && method === "POST") {
      const payload = JSON.parse(options.body);
      return jsonResponse({
        tenant_id: "pilot",
        preview: true,
        can_start_scan: true,
        summary: { error_count: 0, warning_count: 0, info_count: 0 },
        issues: [],
        suggestions: [],
        state: {
          selected_board: { id: payload.board_id, name: "Pilot Leads" },
          mapping: {
            mapped_field_count: Object.keys(payload.mapping.columns ?? {}).length,
          },
        },
      });
    }

    if (url === "https://crm-adapter.example.com/mapping" && method === "PUT") {
      state.mapping = JSON.parse(options.body);
      return jsonResponse({
        tenant_id: "pilot",
        board_id: "board-1",
        mapping: state.mapping,
        validation: {
          tenant_id: "pilot",
          preview: false,
          can_start_scan: true,
          summary: { error_count: 0, warning_count: 0, info_count: 0 },
          issues: [],
          suggestions: [],
          state: {
            mapping: {
              mapped_field_count: Object.keys(state.mapping.columns).length,
            },
          },
        },
      });
    }

    if (url === "https://lead-engine.example.com/run-scan" && method === "POST") {
      state.afterScan = true;
      return jsonResponse({
        scan_id: "scan-2",
        status: "completed",
        owner_count: 150,
        lead_count: 2,
        delivery_summary: { created: 2, skipped_duplicate: 0, failed: 0 },
        leads: [],
        errors: [],
      });
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`);
  });

  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <App />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: /obituary intelligence cockpit/i })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getAllByText(/pilot leads/i).length).toBeGreaterThan(0),
  );

  expect(screen.getByRole("heading", { name: /pre-scan validator/i })).toBeInTheDocument();
  expect(screen.getByText(/0 errors · 0 warnings/i)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/^obituary_url$/i), {
    target: { value: "obit_link" },
  });

  fireEvent.click(screen.getByRole("button", { name: /save mapping/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "https://crm-adapter.example.com/mapping",
      expect.objectContaining({
        method: "PUT",
      }),
    ),
  );

  fireEvent.click(screen.getByRole("button", { name: /run obituary scan/i }));

  await waitFor(() =>
    expect(screen.getAllByText(/scan-2/i).length).toBeGreaterThan(0),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "https://lead-engine.example.com/run-scan",
    expect.objectContaining({
      method: "POST",
    }),
  );
});
