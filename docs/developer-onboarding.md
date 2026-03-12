# Developer Onboarding

## Source Of Truth

Read [docs/system-architecture.md](/Users/jordan/Desktop/LLI_v1/docs/system-architecture.md) first. The important constraint is that `lli-saas` does not own the landowner dataset. Monday.com is the first CRM adapter, and the source owner records come from the Monday `Clients` board at scan time.

## Local setup checklist

1. Install Node.js 20+, Python 3.11+, Docker Desktop, and kubectl.
2. Clone `nice-and-precise/lli-saas`.
3. Install Poetry if it is not already present: `python3 -m pip install --user poetry`.
4. Install backend dependencies:
   - `cd services/lead-engine && poetry install`
   - `cd ../crm-adapter && npm install`
   - `cd ../user-portal && npm install`
5. Copy each `.env.example` file to `.env` if local overrides are needed.
6. Configure the required local environment:
   - `services/lead-engine/.env`: `CRM_ADAPTER_BASE_URL`, `OBITUARY_ENGINE_BASE_URL`
   - `services/crm-adapter/.env`: `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET`, `MONDAY_REDIRECT_URI`
   - `services/user-portal/.env`: `VITE_CRM_ADAPTER_BASE_URL`, `VITE_LEAD_ENGINE_BASE_URL`
7. Start services:
   - `cd services/lead-engine && poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8000`
   - `cd ../crm-adapter && npm run dev`
   - `cd ../user-portal && npm run dev`
8. Verify:
   - `http://localhost:8000/health`
   - `http://localhost:3000/health`
   - `http://localhost:5173/login`
9. Complete Monday OAuth through `crm-adapter`, select the destination lead board, then use the portal or `lead-engine /run-scan` to launch a scan. Each scan pulls owner records fresh from the Monday `Clients` board.
10. Before a real pilot session, run `bash scripts/pilot-readiness-check.sh`.

## Notes

- `lead-engine /run-scan` is the single orchestration entry point.
- `crm-adapter` persists OAuth state, destination board configuration, board mapping, scan-run visibility, and delivery history. It does not persist the owner corpus.
- GSD Codex skills are installed globally under `~/.codex/skills/gsd-*`.
- Phase planning state lives in `.planning/`.
- GHCR image names are defined in the GitHub Actions workflows and `infra/charts/lli-saas/values.yaml`.
