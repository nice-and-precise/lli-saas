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

- reads status, boards, mapping, and pre-scan validation from `crm-adapter`
- lets the operator select a destination board
- lets the operator edit the board mapping for rich obituary/heir fields
- blocks scan submission until Monday validation passes
- surfaces OAuth token health, refresh readiness, required field validation, and actionable setup guidance
- launches scans through `lead-engine /run-scan`
- shows delivery history, latest lead summary, and scan-run visibility

For local pilot work, connect Monday first, select the destination board, save the mapping, then run a scan that pulls fresh owner data from the Monday `Clients` board.
