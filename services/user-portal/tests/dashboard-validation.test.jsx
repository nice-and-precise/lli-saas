import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import App from "../src/App";

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.__LLI_RUNTIME_CONFIG__;
});

test("shows pre-scan validation feedback, applies confident corrections, and blocks scans with errors", async () => {
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
        deliveries: [],
        scan_runs: [],
        latest_delivery: null,
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mapping: {
          item_name_strategy: "deceased_name_county",
          columns: {
            deceased_name: "namez",
            tier: "status",
            obituary_url: "wrong_link",
          },
        },
        field_catalog: {
          crm_fields: [
            { id: "name", label: "Deceased Name", type: "text", description: "CRM field available on Pilot Leads.", example: null },
            { id: "status", label: "Tier", type: "status", description: "CRM field available on Pilot Leads.", example: null },
            { id: "obit_link", label: "Obituary URL", type: "link", description: "CRM field available on Pilot Leads.", example: null },
            { id: "score", label: "Match Score", type: "numbers", description: "CRM field available on Pilot Leads.", example: null },
          ],
          lli_fields: [
            { key: "deceased_name", label: "Deceased name", description: "Primary decedent name.", example: "Pat Example", source_hint: "Contact full-name field.", recommended_types: ["text"], aliases: ["deceased name"], required: true, mapped_column_id: "namez" },
            { key: "tier", label: "Tier", description: "LLI priority tier.", example: "hot", source_hint: "Priority field.", recommended_types: ["status"], aliases: ["tier"], required: true, mapped_column_id: "status" },
            { key: "obituary_url", label: "Obituary URL", description: "Canonical obituary link.", example: "https://example.com/obit", source_hint: "URL field.", recommended_types: ["link"], aliases: ["obituary url"], required: true, mapped_column_id: "wrong_link" },
            { key: "match_score", label: "Match score", description: "Confidence score.", example: "89", source_hint: "Numeric score field.", recommended_types: ["numbers"], aliases: ["match score"], required: true, mapped_column_id: null },
          ],
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        boards: [
          {
            id: "board-1",
            name: "Pilot Leads",
            columns: [
              { id: "name", title: "Deceased Name", type: "text" },
              { id: "status", title: "Tier", type: "status" },
              { id: "obit_link", title: "Obituary URL", type: "link" },
              { id: "score", title: "Match Score", type: "numbers" },
            ],
          },
        ],
        selected_board: {
          id: "board-1",
          name: "Pilot Leads",
          columns: [
            { id: "name", title: "Deceased Name", type: "text" },
            { id: "status", title: "Tier", type: "status" },
            { id: "obit_link", title: "Obituary URL", type: "link" },
            { id: "score", title: "Match Score", type: "numbers" },
          ],
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tenant_id: "pilot",
        preview: false,
        ready: false,
        can_start_scan: false,
        summary: { error_count: 2, warning_count: 1, info_count: 0 },
        capabilities: {
          oauth_app_configured: true,
          token_present: true,
          monday_api_reachable: true,
          source_board_readable: true,
          destination_board_readable: true,
          destination_board_write: "not_tested",
        },
        issues: [
          {
            severity: "error",
            code: "mapped_column_missing",
            scope: "mapping",
            field: "deceased_name",
            column_id: "namez",
            message: "Mapped column \"namez\" for deceased name does not exist on the selected board.",
            suggestion_ids: ["mapping-deceased_name-set_mapping_column-name"],
          },
          {
            severity: "error",
            code: "mapped_column_missing",
            scope: "mapping",
            field: "obituary_url",
            column_id: "wrong_link",
            message: "Mapped column \"wrong_link\" for obituary url does not exist on the selected board.",
            suggestion_ids: ["mapping-obituary_url-set_mapping_column-obit_link"],
          },
          {
            severity: "warning",
            code: "recommended_mapping_missing",
            scope: "mapping",
            field: "match_score",
            message: "Consider mapping match score before the next scan.",
            suggestion_ids: ["mapping-match_score-set_mapping_column-score"],
          },
        ],
        suggestions: [
          {
            id: "mapping-deceased_name-set_mapping_column-name",
            scope: "mapping",
            field: "deceased_name",
            message: 'Use board column "Deceased Name" (name) for deceased name.',
            confidence: "high",
            action: { kind: "set_mapping_column", field: "deceased_name", value: "name" },
          },
          {
            id: "mapping-obituary_url-set_mapping_column-obit_link",
            scope: "mapping",
            field: "obituary_url",
            message: 'Use board column "Obituary URL" (obit_link) for obituary url.',
            confidence: "high",
            action: { kind: "set_mapping_column", field: "obituary_url", value: "obit_link" },
          },
          {
            id: "mapping-match_score-set_mapping_column-score",
            scope: "mapping",
            field: "match_score",
            message: 'Use board column "Match Score" (score) for match score.',
            confidence: "medium",
            action: { kind: "set_mapping_column", field: "match_score", value: "score" },
          },
        ],
        state: {
          source_board: { id: "clients-board", name: "Clients" },
          selected_board: {
            id: "board-1",
            name: "Pilot Leads",
            columns: [
              { id: "name", title: "Deceased Name", type: "text" },
              { id: "status", title: "Tier", type: "status" },
              { id: "obit_link", title: "Obituary URL", type: "link" },
              { id: "score", title: "Match Score", type: "numbers" },
            ],
          },
          mapping: {
            item_name_strategy: "deceased_name_county",
            mapped_field_count: 3,
          },
        },
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
        field_catalog: {
          crm_fields: [
            { id: "name", label: "Deceased Name", type: "text", description: "CRM field available on Pilot Leads.", example: null },
            { id: "status", label: "Tier", type: "status", description: "CRM field available on Pilot Leads.", example: null },
            { id: "obit_link", label: "Obituary URL", type: "link", description: "CRM field available on Pilot Leads.", example: null },
            { id: "score", label: "Match Score", type: "numbers", description: "CRM field available on Pilot Leads.", example: null },
          ],
          lli_fields: [
            { key: "deceased_name", label: "Deceased name", description: "Primary decedent name.", example: "Pat Example", source_hint: "Contact full-name field.", recommended_types: ["text"], aliases: ["deceased name"], required: true, mapped_column_id: "name" },
            { key: "tier", label: "Tier", description: "LLI priority tier.", example: "hot", source_hint: "Priority field.", recommended_types: ["status"], aliases: ["tier"], required: true, mapped_column_id: "status" },
            { key: "obituary_url", label: "Obituary URL", description: "Canonical obituary link.", example: "https://example.com/obit", source_hint: "URL field.", recommended_types: ["link"], aliases: ["obituary url"], required: true, mapped_column_id: "obit_link" },
            { key: "match_score", label: "Match score", description: "Confidence score.", example: "89", source_hint: "Numeric score field.", recommended_types: ["numbers"], aliases: ["match score"], required: true, mapped_column_id: null },
          ],
        },
        validation: {
          tenant_id: "pilot",
          preview: false,
          ready: false,
          can_start_scan: false,
          summary: { error_count: 0, warning_count: 1, info_count: 0 },
          capabilities: {
            oauth_app_configured: true,
            token_present: true,
            monday_api_reachable: true,
            source_board_readable: true,
            destination_board_readable: true,
            destination_board_write: "not_tested",
          },
          issues: [
            {
              severity: "warning",
              code: "recommended_mapping_missing",
              scope: "mapping",
              field: "match_score",
              message: "Consider mapping match score before the next scan.",
              suggestion_ids: ["mapping-match_score-set_mapping_column-score"],
            },
          ],
          suggestions: [
            {
              id: "mapping-match_score-set_mapping_column-score",
              scope: "mapping",
              field: "match_score",
              message: 'Use board column "Match Score" (score) for match score.',
              confidence: "medium",
              action: { kind: "set_mapping_column", field: "match_score", value: "score" },
            },
          ],
          state: {
            source_board: { id: "clients-board", name: "Clients" },
            selected_board: { id: "board-1", name: "Pilot Leads", columns: [] },
            mapping: {
              item_name_strategy: "deceased_name_county",
              mapped_field_count: 3,
            },
          },
        },
      }),
    });

  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <App />
    </MemoryRouter>,
  );

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: /pre-scan validator/i })).toBeInTheDocument(),
  );

  await waitFor(() =>
    expect(screen.getByText(/2 errors · 1 warning/i)).toBeInTheDocument(),
  );
  expect(screen.getByText(/mapped column "namez"/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /apply 2 confident fixes/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "https://crm-adapter.example.com/mapping",
      expect.objectContaining({ method: "PUT" }),
    ),
  );

  await waitFor(() =>
    expect(screen.getByLabelText(/^CRM field for deceased_name$/i)).toHaveValue("name"),
  );
  expect(screen.getByLabelText(/^CRM field for obituary_url$/i)).toHaveValue("obit_link");
  expect(screen.getByText(/0 errors · 1 warning/i)).toBeInTheDocument();

  const scanButton = screen.getByRole("button", { name: /fix validator errors before running scan/i });
  expect(scanButton).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalledWith(
    "https://lead-engine.example.com/run-scan",
    expect.anything(),
  );
});
