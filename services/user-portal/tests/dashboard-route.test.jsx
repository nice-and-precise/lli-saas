import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import App from "../src/App";

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.__LLI_RUNTIME_CONFIG__;
});

test("preserves pre-scan validation details, blocks scan submission, and revalidates after mapping changes", async () => {
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
            owner_name: "owner_col",
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
      ok: false,
      json: async () => ({
        ready: false,
        status: "action_required",
        selected_board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
        token_validation: {
          status: "valid",
          message: "Monday OAuth token is valid.",
          refresh: {
            status: "not_supported",
            message: "Stored token can be validated, but proactive refresh is not supported because no refresh token is available.",
          },
        },
        board_validation: {
          field_results: [
            { field: "owner_name", label: "Owner Name", status: "valid", message: "Owner Name is mapped to Owner Name." },
            { field: "obituary_url", label: "Obituary URL", status: "missing_mapping", message: "Obituary URL is not mapped to a Monday column.", guidance: "Map Obituary URL to a Monday column before running a scan." },
            { field: "tier", label: "Tier", status: "valid", message: "Tier is mapped to Tier." },
          ],
        },
        issues: [
          { code: "missing_required_mapping", message: "Obituary URL is not mapped to a Monday column.", guidance: "Open board mapping and assign a destination column for Obituary URL." },
        ],
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
            owner_name: "owner_col",
            tier: "status",
            obituary_url: "obit_link",
          },
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ready: true,
        status: "ready",
        selected_board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
        token_validation: {
          status: "valid",
          message: "Monday OAuth token is valid.",
          refresh: {
            status: "not_supported",
            message: "Stored token can be validated, but proactive refresh is not supported because no refresh token is available.",
          },
        },
        board_validation: {
          field_results: [
            { field: "owner_name", label: "Owner Name", status: "valid", message: "Owner Name is mapped to Owner Name." },
            { field: "obituary_url", label: "Obituary URL", status: "valid", message: "Obituary URL is mapped to Obituary URL." },
            { field: "tier", label: "Tier", status: "valid", message: "Tier is mapped to Tier." },
          ],
        },
        issues: [],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ready: true,
        status: "ready",
        selected_board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
        token_validation: {
          status: "valid",
          message: "Monday OAuth token is valid.",
          refresh: {
            status: "not_supported",
            message: "Stored token can be validated, but proactive refresh is not supported because no refresh token is available.",
          },
        },
        board_validation: {
          field_results: [
            { field: "owner_name", label: "Owner Name", status: "valid", message: "Owner Name is mapped to Owner Name." },
            { field: "obituary_url", label: "Obituary URL", status: "valid", message: "Obituary URL is mapped to Obituary URL." },
            { field: "tier", label: "Tier", status: "valid", message: "Tier is mapped to Tier." },
          ],
        },
        issues: [],
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
        leads: [],
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
            owner_name: "owner_col",
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
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ready: true,
        status: "ready",
        selected_board: { id: "board-1", name: "Pilot Leads", columns: [{ id: "name", title: "Name", type: "text" }] },
        token_validation: {
          status: "valid",
          message: "Monday OAuth token is valid.",
          refresh: {
            status: "not_supported",
            message: "Stored token can be validated, but proactive refresh is not supported because no refresh token is available.",
          },
        },
        board_validation: {
          field_results: [
            { field: "owner_name", label: "Owner Name", status: "valid", message: "Owner Name is mapped to Owner Name." },
            { field: "obituary_url", label: "Obituary URL", status: "valid", message: "Obituary URL is mapped to Obituary URL." },
            { field: "tier", label: "Tier", status: "valid", message: "Tier is mapped to Tier." },
          ],
        },
        issues: [],
      }),
    });

  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <App />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: /obituary intelligence cockpit/i })).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText(/pilot leads/i).length).toBeGreaterThan(0));

  expect(screen.getByText(/fix monday setup issues before starting a scan/i)).toBeInTheDocument();
  expect(screen.getAllByText(/obituary url is not mapped to a monday column/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/refresh readiness:/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /run obituary scan/i })).toBeDisabled();

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
  await waitFor(() => expect(screen.getByRole("button", { name: /run obituary scan/i })).toBeEnabled());

  fireEvent.click(screen.getByRole("button", { name: /run obituary scan/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lead-engine.example.com/run-scan",
      expect.objectContaining({
        method: "POST",
      }),
    ),
  );
  await waitFor(() => expect(screen.getAllByText(/scan-2/i).length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByText(/2 leads generated/i)).toBeInTheDocument());
});
