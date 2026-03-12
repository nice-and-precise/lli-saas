# Pilot Runbook: David Whitaker

## Goal

Connect Monday.com, configure the destination lead board, run an obituary scan, and verify that tiered inherited-land leads appear in David Whitaker's Monday board with the expected obituary and heir metadata.

## Services And URLs

- `lead-engine` on `http://localhost:8000`
- `obituary-intelligence-engine` on `http://localhost:8080`
- `crm-adapter` on `http://localhost:3000`
- `user-portal` on `http://localhost:5173`

The portal reads board/status data from `crm-adapter` and launches scans through `lead-engine`. Each scan fetches fresh owner records from the Monday `Clients` board.

## Required Environment

1. Copy each service `.env.example` to a local `.env`.
2. Set:
   - `services/lead-engine/.env`: `CRM_ADAPTER_BASE_URL`, `OBITUARY_ENGINE_BASE_URL`
   - `services/obituary-intelligence-engine/.env`: state path, retention, timeout, and AI provider keys if available
   - `services/crm-adapter/.env`: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, `MONDAY_REDIRECT_URI`, `CRM_ADAPTER_STATE_PATH`
   - `services/user-portal/.env`: `VITE_CRM_ADAPTER_BASE_URL`, `VITE_LEAD_ENGINE_BASE_URL`
3. Make sure the Monday OAuth redirect URI matches the actual adapter callback URL.

## Runbook

1. Start all four services.
2. Confirm `/ready` succeeds for `lead-engine`, `obituary-intelligence-engine`, and `crm-adapter`.
3. Open the portal at `/login`, then move to `/dashboard`.
4. Complete Monday OAuth through `crm-adapter` via `/auth/login`.
5. Confirm the callback returns `connected: true`.
6. Confirm `GET /boards` returns the intended destination lead board.
7. Confirm `GET /owners` returns owner records from the Monday `Clients` board.
8. Select the destination board.
9. Review and update the board mapping.
10. Run the obituary scan from the dashboard.
11. Confirm the dashboard updates with:
    - delivery history
    - lead tier
    - match score
    - heir count
    - scan-run status
12. Verify the created Monday item includes the expected obituary URL, tier, and heir-related fields.

## Troubleshooting

- If OAuth fails, verify `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, and `MONDAY_REDIRECT_URI`.
- If the portal cannot load boards or status, verify the CRM adapter base URL and `/ready`.
- If the scan cannot launch, verify `lead-engine` can reach `obituary-intelligence-engine`.
- If no heir data appears, verify the obituary text passed the actionability gate and that provider keys are present if LLM extraction is expected.
- If Monday items duplicate, inspect delivery history and confirm obituary URL identity handling.
- If state disappears after restart in Kubernetes, verify both the CRM adapter PVC and obituary-engine PVC are mounted and writable.
