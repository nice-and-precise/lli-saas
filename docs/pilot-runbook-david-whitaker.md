# Pilot Runbook: David Whitaker

## Goal

Connect Monday.com, configure the destination lead board, run an obituary scan from the portal, and verify that the resulting leads appear in David Whitaker's Monday board.

## Services and URLs

- `lead-engine` on `http://localhost:8000`
- `crm-adapter` on `http://localhost:3000`
- `user-portal` on `http://localhost:5173`

The portal reads status from `crm-adapter` and launches scans through `lead-engine`. Each scan fetches source owner records fresh from the Monday `Clients` board.

## Required Environment

1. Copy each service `.env.example` to a local `.env`.
2. Set the following values before starting the pilot flow:
   - `services/lead-engine/.env`: `CRM_ADAPTER_BASE_URL`, `OBITUARY_ENGINE_BASE_URL`
   - `services/crm-adapter/.env`: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, `MONDAY_REDIRECT_URI`
   - `services/user-portal/.env`: `VITE_CRM_ADAPTER_BASE_URL`, `VITE_LEAD_ENGINE_BASE_URL`
3. Make sure the Monday OAuth redirect URI matches the adapter callback URL you are actually using.

## Steps

1. Start the three services locally or in the target environment.
2. Confirm `lead-engine` and `crm-adapter` return healthy responses from `/health`.
3. Open the portal at `/login`, then move to `/dashboard`.
4. Complete Monday OAuth through `crm-adapter` by visiting `/auth/login`.
5. Confirm the callback returns `connected: true`.
6. Confirm `GET /boards` returns the destination lead board and `GET /owners` returns owner records from the Monday `Clients` board.
7. Select the destination lead board with `POST /boards/select`.
8. Confirm the current mapping with `GET /mapping` and adjust it with `PUT /mapping` if the selected board uses different column IDs.
9. Return to the portal dashboard and run the obituary scan.
10. Confirm the dashboard updates with delivery history and scan-run status.
11. Verify the created item appears in David's Monday destination board with the expected item name and mapped field values.

## Troubleshooting

- If OAuth fails, verify `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, and `MONDAY_REDIRECT_URI`, then retry `/auth/login`.
- If the portal cannot load status, verify `VITE_CRM_ADAPTER_BASE_URL` points to the reachable `crm-adapter` URL.
- If the portal cannot launch a scan, verify `VITE_LEAD_ENGINE_BASE_URL` points to the reachable `lead-engine` URL.
- If `GET /owners` fails, verify the Monday workspace contains a `Clients` board and that the OAuth token can read it.
- If the obituary scan fails, verify `CRM_ADAPTER_BASE_URL` points to the reachable `crm-adapter` service and that `OBITUARY_ENGINE_BASE_URL` is valid upstream.
- If GraphQL calls hit rate limits, confirm the CRM adapter retries and then stops after the third attempt.
- If the scan succeeds but no item appears, inspect `GET /deliveries` and `GET /status` in `crm-adapter` before retrying delivery.
