# lead-engine

Phase 2 FastAPI service for the lead engine scan workflow.

## Commands

- Install: `poetry install`
- Run: `poetry run uvicorn src.app:app --reload --host 0.0.0.0 --port 8000`
- Test: `poetry run pytest`

## Runtime

- `POST /run-scan` accepts `county`, `state`, optional `limit`, and `include_contacts`.
- Set `REAPER_BASE_URL` to the upstream Reaper service base URL so `lead-engine` can forward scan requests.
