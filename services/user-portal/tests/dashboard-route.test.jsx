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
        field_catalog: {
          crm_fields: [
            { id: "name", label: "Name", type: "text", description: "CRM field available on Pilot Leads.", example: null },
            { id: "status", label: "Status", type: "status", description: "CRM field available on Pilot Leads.", example: null },
            { id: "obit_link", label: "Obituary Link", type: "link", description: "CRM field available on Pilot Leads.", example: null },
          ],
          lli_fields: [
            {
              key: "deceased_name",
              label: "Deceased name",
              description: "Primary decedent name that appears in the obituary and becomes the anchor for the delivered lead.",
              example: "Pat Example",
              source_hint: "Usually comes from a CRM person/contact full-name field or a normalized decedent name field.",
              recommended_types: ["text", "long_text", "name"],
              aliases: ["deceased name", "decedent", "name"],
              required: true,
              mapped_column_id: state.mapping.columns.deceased_name ?? null,
            },
            {
              key: "tier",
              label: "Tier",
              description: "LLI priority tier for the resulting lead based on signal strength and urgency.",
              example: "hot",
              source_hint: "Map to a priority, temperature, or lead-tier field if one exists.",
              recommended_types: ["status", "dropdown", "text"],
              aliases: ["tier", "priority", "lead tier"],
              required: true,
              mapped_column_id: state.mapping.columns.tier ?? null,
            },
            {
              key: "obituary_url",
              label: "Obituary URL",
              description: "Canonical link back to the obituary page used for review and auditability.",
              example: "https://example.com/obituaries/pat-example",
              source_hint: "Map from a URL/link field whenever the CRM stores direct source links.",
              recommended_types: ["link"],
              aliases: ["obituary url", "obituary link", "obit url", "obit link", "obit"],
              required: true,
              mapped_column_id: state.mapping.columns.obituary_url ?? null,
            },
          ],
        },
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
        leads: [
          {
            scan_id: "scan-2",
            source: "obituary_intelligence_engine",
            run_started_at: "2026-03-11T10:00:00Z",
            run_completed_at: "2026-03-11T10:01:00Z",
            owner_id: "owner-2",
            owner_name: "Taylor Example",
            deceased_name: "Taylor Example",
            property: {
              county: "Boone",
              state: "IA",
              acres: 120.5,
              parcel_ids: ["parcel-2"],
              address_line_1: "123 County Road",
              city: "Boone",
              postal_code: "50036",
              operator_name: "Johnson Farms LLC",
            },
            heirs: [],
            obituary: {
              url: "https://example.com/obit-2",
              source_id: "the_gazette",
              published_at: "2026-03-11T11:00:00Z",
              death_date: "2026-03-09",
              deceased_city: "Ames",
              deceased_state: "IA",
            },
            match: {
              score: 89,
              last_name_score: 96,
              first_name_score: 80,
              location_bonus_applied: false,
              status: "pending_review",
              matched_fields: ["last_name", "first_name"],
              explanation: [
                "Last name similarity scored 96.0 against owner record.",
                "First name similarity scored 80.0 after nickname expansion.",
              ],
            },
            tier: "pending_review",
            out_of_state_heir_likely: false,
            out_of_state_states: [],
            executor_mentioned: false,
            unexpected_death: false,
            notes: [],
            tags: ["tier:pending_review"],
            raw_artifacts: ["artifact-1.json"],
            owner_profile_url: "lli://owner-profile/board:clients:item:owner-2",
            obituary_raw_url: "https://example.com/obit-2",
          },
        ],
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

  fireEvent.change(screen.getByLabelText(/^CRM field for obituary_url$/i), {
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
  expect(screen.getByText(/confidence score:/i)).toBeInTheDocument();
  expect(screen.getByText(/89.0%/i)).toBeInTheDocument();
  expect(screen.getByText(/matched fields: last_name, first_name/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view raw obituary/i })).toHaveAttribute("href", "https://example.com/obit-2");
  expect(screen.getByRole("link", { name: /view owner profile/i })).toHaveAttribute("href", "lli://owner-profile/board:clients:item:owner-2");
});
