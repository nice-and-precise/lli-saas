# Pilot Runbook: David Whitaker

## Goal

Connect Monday.com, configure the target board, run the first scan from the portal, and verify that the first lead appears in David Whitaker's board.

## Services and URLs

- `lead-engine` on `http://localhost:8000`
- `crm-adapter` on `http://localhost:3000`
- `user-portal` on `http://localhost:5173`

The current operator flow is portal-first. The portal reads status and launches the first scan through `crm-adapter`, and `crm-adapter` coordinates with `lead-engine`.

## Required Environment

1. Copy each service `.env.example` to a local `.env`.
2. Set the following values before starting the pilot flow:
   - `services/lead-engine/.env`: `REAPER_BASE_URL`
   - `services/crm-adapter/.env`: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, `MONDAY_REDIRECT_URI`, `LEAD_ENGINE_BASE_URL`
   - `services/user-portal/.env`: `VITE_CRM_ADAPTER_BASE_URL`
3. Make sure the Monday OAuth redirect URI matches the adapter callback URL you are actually using.

## Steps

1. Start the three services locally or in the target environment.
2. Confirm `lead-engine` and `crm-adapter` return healthy responses from `/health`.
3. Open the portal at `/login`, then move to `/dashboard`.
4. Complete Monday OAuth through `crm-adapter` by visiting `/auth/login`.
5. Confirm the callback returns `connected: true` and that `GET /boards` returns the target Monday board.
6. Select the target board with `POST /boards/select`.
7. Confirm the current mapping with `GET /mapping` and adjust it with `PUT /mapping` if the selected board uses different column IDs.
8. Return to the portal dashboard and run the first scan from the first-scan launcher.
9. Confirm the dashboard updates with delivery history and scan run status.
10. Verify the created item appears in David's Monday board with the expected item name and mapped field values.

## Troubleshooting

- If OAuth fails, verify `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, and `MONDAY_REDIRECT_URI`, then retry `/auth/login`.
- If the portal cannot load status, verify `VITE_CRM_ADAPTER_BASE_URL` points to the reachable `crm-adapter` URL.
- If the first scan fails, verify `LEAD_ENGINE_BASE_URL` points to the reachable `lead-engine` service and that `REAPER_BASE_URL` is valid upstream.
- If GraphQL calls hit rate limits, confirm the CRM adapter retries and then stops after the third attempt.
- If the board query succeeds but no item appears, inspect `GET /deliveries` and `GET /status` in `crm-adapter` before retrying delivery.
