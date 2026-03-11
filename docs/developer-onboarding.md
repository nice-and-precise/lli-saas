# Developer Onboarding

## Local setup checklist

1. Install Node.js 20+, Python 3.11+, Docker Desktop, and kubectl.
2. Clone `nice-and-precise/lli-saas`.
3. Install Poetry if it is not already present: `python3 -m pip install --user poetry`.
4. Install backend dependencies:
   - `cd services/lead-engine && poetry install`
   - `cd ../crm-adapter && npm install`
   - `cd ../user-portal && npm install`
5. Copy each `.env.example` file to `.env` if local overrides are needed.
6. Start services:
   - `cd services/lead-engine && poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8000`
   - `cd services/crm-adapter && npm run dev`
   - `cd services/user-portal && npm run dev`
7. Verify:
   - `http://localhost:8000/health`
   - `http://localhost:3000/health`
   - `http://localhost:5173/login`

## Notes

- GSD Codex skills are installed globally under `~/.codex/skills/gsd-*`.
- Phase planning state lives in `.planning/`.
- GHCR image names are defined in the GitHub Actions workflows and `infra/charts/lli-saas/values.yaml`.

