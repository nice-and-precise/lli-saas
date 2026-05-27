# user-portal

Pilot operator portal for `lli-saas` with live Monday delivery status, destination-board mapping visibility, and obituary scan controls.

## Commands

- Install: `npm install`
- Run: `npm run dev`
- Test: `npm test`
- Build: `npm run build`

## Environment

- Local dev uses `VITE_CRM_ADAPTER_BASE_URL` and `VITE_LEAD_ENGINE_BASE_URL`.
- Production reads `window.__LLI_RUNTIME_CONFIG__` from `/runtime-config.js`.
- The container startup script writes `/runtime-config.js` from `CRM_ADAPTER_BASE_URL` and `LEAD_ENGINE_BASE_URL`.

## Operator flow

The dashboard:

- reads status, boards, and mapping from `crm-adapter`
- **auto-onboards on first connect** — calls `POST /onboard/auto-provision`, which detects the owner
  source board, builds the "Land Legacy Leads" destination board, and maps every field automatically
- lets the operator override the source board, destination board, and mapping if needed
- launches scans through `lead-engine /run-scan`
- shows an adaptive "Next step" cue, pipeline metrics, delivery history, and scan-run visibility

For local pilot work, just connect Monday — onboarding configures itself, then press **Run obituary
scan**. Owners are read from the auto-detected source board (override or CSV-import as fallbacks).
