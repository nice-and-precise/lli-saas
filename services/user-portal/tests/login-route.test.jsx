import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { MemoryRouter } from "react-router-dom";

import LoginPage from "../src/pages/LoginPage";
import { SESSION_STORAGE_KEY } from "../src/session";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete globalThis.__LLI_RUNTIME_CONFIG__;
});

test("logs in through /session/login and stores the bearer token", async () => {
  globalThis.__LLI_RUNTIME_CONFIG__ = {
    crmAdapterBaseUrl: "https://crm-adapter.example.com",
    leadEngineBaseUrl: "https://lead-engine.example.com",
  };

  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "jwt-token",
        token_type: "Bearer",
        expires_in: 3600,
        claims: {
          sub: "pilot@example.com",
          role: "operator",
          tenant_id: "pilot",
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sub: "pilot@example.com",
        role: "operator",
        tenant_id: "pilot",
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tenant_id: "pilot",
        board: null,
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
          columns: {},
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        boards: [],
        selected_board: null,
      }),
    });

  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: /broker access starts here/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /login/i })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "pilot@example.com" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: /continue to dashboard/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "https://crm-adapter.example.com/session/login",
      expect.objectContaining({
        method: "POST",
      }),
    ),
  );
  expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe("jwt-token");
  expect(navigateMock).toHaveBeenCalledWith("/dashboard");
});
