# user-portal

Pilot operator portal for `lli-saas` with live Monday delivery status, destination-board mapping visibility, and obituary scan controls.

## Commands

- Install: `npm install`
- Run: `npm run dev`
- Lint: `npm run lint`
- Format check: `npm run format:check`
- Test: `npm test`
- Build: `npm run build`

## Environment

- Local dev uses `VITE_CRM_ADAPTER_BASE_URL` and `VITE_LEAD_ENGINE_BASE_URL`.
- Production reads `window.__LLI_RUNTIME_CONFIG__` from `/runtime-config.js`.
- The container startup script writes `/runtime-config.js` from `CRM_ADAPTER_BASE_URL` and `LEAD_ENGINE_BASE_URL`.

## Operator flow

The dashboard:

- signs in through `crm-adapter /session/login` and stores a bearer token locally for the pilot session
- reads status, boards, and mapping from `crm-adapter`
- lets the operator select a destination board
- lets the operator edit the board mapping for rich obituary/heir fields
- launches scans through `lead-engine /run-scan`
- shows delivery history, latest lead summary, and scan-run visibility
- opens Monday OAuth through `crm-adapter /auth/login-url` so the portal can attach the authenticated operator session before redirecting

For local pilot work, connect Monday first, select the destination board, save the mapping, then run a scan that pulls fresh owner data from the Monday `Clients` board.
