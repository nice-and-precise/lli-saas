import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import App from "../src/App";

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.__LLI_RUNTIME_CONFIG__;
});

test("renders live dashboard status, saves mapping, and runs the obituary scan flow", async () => {
  globalThis.__LLI_RUNTIME_CONFIG__ = {
    crmAdapterBaseUrl: "https://crm-adapter.example.com",
    leadEngineBaseUrl: "https://lead-engine.example.com",
  };

  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
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
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mapping: {
          item_name_strategy: "deceased_name_county",
          columns: {
            deceased_name: "name",
            tier: "status",
          },
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        boards: [{ id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] }],
        selected_board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tenant_id: "pilot",
        board_id: "board-1",
        mapping: {
          item_name_strategy: "deceased_name_county",
          columns: {
            deceased_name: "name",
            tier: "status",
            obituary_url: "obit_link",
          },
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
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
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tenant_id: "pilot",
        board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
        deliveries: [{ id: "delivery-2", item_name: "Taylor Example - Boone County", status: "created", scan_id: "scan-2", summary: { tier: "pending_review" } }],
        scan_runs: [{ scan_id: "scan-2", last_delivery_status: "created" }],
        latest_delivery: {
          id: "delivery-2",
          item_name: "Taylor Example - Boone County",
          status: "created",
          scan_id: "scan-2",
          summary: { tier: "pending_review", match_score: 89.0, heir_count: 1 },
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mapping: {
          item_name_strategy: "deceased_name_county",
          columns: {
            deceased_name: "name",
            tier: "status",
            obituary_url: "obit_link",
          },
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        boards: [{ id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] }],
        selected_board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
      }),
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
  expect(screen.getAllByText(/deceased_name_county/i).length).toBeGreaterThan(0);

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
  expect(screen.getByText(/confidence score:/i)).toBeInTheDocument();
  expect(screen.getByText(/89.0%/i)).toBeInTheDocument();
  expect(screen.getByText(/matched fields: last_name, first_name/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view raw obituary/i })).toHaveAttribute("href", "https://example.com/obit-2");
  expect(screen.getByRole("link", { name: /view owner profile/i })).toHaveAttribute("href", "lli://owner-profile/board:clients:item:owner-2");
});
