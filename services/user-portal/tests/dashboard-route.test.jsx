import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import App from "../src/App";

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders live dashboard status and runs the first scan flow", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tenant_id: "pilot",
        board: { id: "board-1", name: "Pilot Leads" },
        deliveries: [{ id: "delivery-1", item_name: "Pat Example - 123 County Road", status: "created", scan_id: "scan-1" }],
        scan_runs: [{ scan_id: "scan-1", last_delivery_status: "created" }],
        latest_delivery: {
          id: "delivery-1",
          item_name: "Pat Example - 123 County Road",
          status: "created",
          scan_id: "scan-1",
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mapping: {
          item_name_strategy: "deceased_name_address",
          columns: {
            deceased_name: "name",
            owner_name: "owner_column",
          },
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        scan_id: "scan-2",
        totals: { created: 1, skipped_duplicate: 0, failed: 0 },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tenant_id: "pilot",
        board: { id: "board-1", name: "Pilot Leads" },
        deliveries: [{ id: "delivery-2", item_name: "Taylor Example - 456 Ranch Road", status: "created", scan_id: "scan-2" }],
        scan_runs: [{ scan_id: "scan-2", last_delivery_status: "created" }],
        latest_delivery: {
          id: "delivery-2",
          item_name: "Taylor Example - 456 Ranch Road",
          status: "created",
          scan_id: "scan-2",
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        mapping: {
          item_name_strategy: "deceased_name_address",
          columns: {
            deceased_name: "name",
            owner_name: "owner_column",
          },
        },
      }),
    });

  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <App />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: /monday delivery cockpit/i })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getAllByText(/pilot leads/i).length).toBeGreaterThan(0),
  );
  expect(screen.getByText(/deceased_name_address/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /run first scan/i }));

  await waitFor(() =>
    expect(screen.getAllByText(/scan-2/i).length).toBeGreaterThan(0),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:3000/first-scan",
    expect.objectContaining({
      method: "POST",
    }),
  );
});
