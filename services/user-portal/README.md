# user-portal

Pilot operator portal for `lli-saas` with live Monday delivery status, board mapping visibility, and first-scan controls.

## Commands

- Install: `npm install`
- Run: `npm run dev`
- Test: `npm test`
- Build: `npm run build`

## Environment

- `VITE_CRM_ADAPTER_BASE_URL` points the dashboard at the running `crm-adapter` instance.

## Pilot Flow

The dashboard expects `crm-adapter` to handle status reads and first-scan orchestration. For local pilot work, start the adapter first, then run the portal and verify the dashboard can load status before using the first-scan launcher.
