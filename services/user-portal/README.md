# user-portal

Pilot operator portal for `lli-saas` with live Monday delivery status, destination-board mapping visibility, and obituary scan controls.

## Commands

- Install: `npm install`
- Run: `npm run dev`
- Test: `npm test`
- Build: `npm run build`

## Environment

- `VITE_CRM_ADAPTER_BASE_URL` points status, mapping, and OAuth-related UI calls at the running `crm-adapter` instance.
- `VITE_LEAD_ENGINE_BASE_URL` points scan launch requests at the running `lead-engine` instance.

## Operator flow

The dashboard reads status and mapping from `crm-adapter` and launches scans through `lead-engine /run-scan`. For local pilot work, connect Monday first, select the destination board, then run a scan that pulls fresh owner data from the Monday `Clients` board.
