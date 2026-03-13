# Pilot Runbook: David Whitaker

## Goal

Connect Monday.com, configure the destination lead board, run an obituary scan, and verify that tiered inherited-land leads appear in David Whitaker's Monday board with the expected obituary and heir metadata.

## Services And URLs

For local rehearsal:

- `lead-engine` on `http://localhost:8000`
- `obituary-intelligence-engine` on `http://localhost:8080`
- `crm-adapter` on `http://localhost:3000`
- `user-portal` on `http://localhost:5173`

For the currently verified live pilot on March 12, 2026:

- `lead-engine` on `http://lead.34.57.110.0.sslip.io:8000`
- `crm-adapter` on `http://crm.34.42.223.140.sslip.io`
- `user-portal` on `http://portal.35.225.151.173.sslip.io`
- Monday OAuth callback on `http://crm.34.42.223.140.sslip.io/auth/callback`
- `obituary-intelligence-engine` remains cluster-internal in the live pilot and is reached through `lead-engine`

Current verified success target:

- destination lead board: `lli-saas Pilot Leads` (`18403599732`)
- final successful scan: `0754b40d-6a1e-4b49-96e7-2d966c335e19`
- final verified Monday item: `Elaine Carter - Boone County` (`11497241942`)

The portal reads board/status data from `crm-adapter` and launches scans through `lead-engine`. Each scan fetches fresh owner records from the Monday `Clients` board.

## Required Environment

1. Copy each service `.env.example` to a local `.env`.
2. Set:
   - `services/lead-engine/.env`: `CRM_ADAPTER_BASE_URL`, `OBITUARY_ENGINE_BASE_URL`, `AUTH_JWT_SECRET`
   - `services/obituary-intelligence-engine/.env`: state path, retention, timeout, AI provider keys if available, and `AUTH_JWT_SECRET`
   - `services/crm-adapter/.env`: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, `MONDAY_REDIRECT_URI`, `CRM_ADAPTER_STATE_PATH`, `AUTH_JWT_SECRET`, `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`
   - `services/user-portal/.env`: `VITE_CRM_ADAPTER_BASE_URL`, `VITE_LEAD_ENGINE_BASE_URL`
3. Make sure `AUTH_ALLOWED_ORIGINS` matches the portal origin and the Monday OAuth redirect URI matches the actual adapter callback URL.

## Runbook

1. Start all four services locally, or open the verified live pilot endpoints above if you are rehearsing against the deployed pilot.
2. Confirm `/ready` succeeds for `lead-engine`, `obituary-intelligence-engine`, and `crm-adapter`.
3. Run `python3 scripts/validate-obituary-sources.py --include-supplemental --json-output /tmp/obituary-sources.json`.
4. Generate or provision a valid service JWT for any background caller such as the daily lead-scan CronJob.
5. Open the portal at `/login` and sign in with the configured operator credentials.
6. From the dashboard, use `Connect Monday`.
7. Confirm the callback returns the operator to the dashboard and that board discovery succeeds.
8. Confirm authenticated `GET /boards` returns the intended destination lead board.
9. Confirm authenticated `GET /owners` returns owner records from the Monday `Clients` board.
10. Confirm authenticated `GET /sources/health?include_supplemental=true` reports source coverage, keeps `proof_target_count` at `6`, and shows at least `7` healthy sources before the rehearsal scan.
11. Select the destination board.
12. Review and update the board mapping.
13. Run the obituary scan from the dashboard.
14. Confirm the dashboard updates with:
    - delivery history
    - lead tier
    - match score
    - heir count
    - scan-run status
15. Verify the created Monday item includes the expected obituary URL, tier, and heir-related fields.

## Troubleshooting

- If OAuth fails, verify `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, and `MONDAY_REDIRECT_URI`.
- If portal login fails, verify `OPERATOR_EMAIL`, `OPERATOR_PASSWORD`, and the shared `AUTH_JWT_SECRET`.
- If browser requests fail before hitting the service, verify `AUTH_ALLOWED_ORIGINS` on all backend services.
- If the live pilot callback fails, verify `MONDAY_REDIRECT_URI` is `http://crm.34.42.223.140.sslip.io/auth/callback` and `OPERATOR_PORTAL_BASE_URL` is `http://portal.35.225.151.173.sslip.io`.
- If source validation is weak, inspect `/sources/health?include_supplemental=true` and the validation JSON before blaming Monday integration.
- If the portal cannot load boards or status, verify the CRM adapter base URL and `/ready`.
- If the scan cannot launch, verify `lead-engine` can reach `obituary-intelligence-engine` and that the bearer token is being forwarded.
- If no heir data appears, verify the obituary text passed the actionability gate and that provider keys are present if LLM extraction is expected.
- If Monday items duplicate, inspect delivery history and confirm obituary URL identity handling.
- If state disappears after restart in Kubernetes, verify both the CRM adapter PVC and obituary-engine PVC are mounted and writable.
