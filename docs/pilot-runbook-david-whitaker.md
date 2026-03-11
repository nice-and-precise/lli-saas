# Pilot Runbook: David Whitaker

## Goal

Connect Monday.com, run the first scan flow, and verify that the first lead appears in David Whitaker's board.

## Steps

1. Start the three Phase 1 services locally or in the target environment.
2. Open the portal at `/login` and move to `/dashboard`.
3. In the CRM adapter, initiate Monday OAuth by visiting `/auth/login`.
4. Authorize the Monday app and confirm the callback returns `connected: true`.
5. Use the Monday boards query stored in `services/crm-adapter/src/queries.js` to verify board visibility.
6. Configure the target board for lead delivery.
7. Trigger the first scan from the lead-engine follow-up flow once Reaper integration is wired in.
8. Verify the first created item appears in David's Monday board with the expected name and board placement.

## Troubleshooting

- If OAuth fails, verify `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, and `MONDAY_REDIRECT_URI`.
- If GraphQL calls hit rate limits, confirm the CRM adapter retries and then backs off after the third attempt.
- If the board query succeeds but no item appears, re-run the `create_item` mutation using the target board ID.

