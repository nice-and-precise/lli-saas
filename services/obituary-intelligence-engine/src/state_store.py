from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path


class ObituaryStateStore:
    def __init__(self, path: str | None = None, retention_days: int | None = None) -> None:
        self.path = Path(
            path
            or os.getenv("OBITUARY_ENGINE_STATE_PATH")
            or "/var/lib/lli-saas/obituary-intelligence-engine/state.json"
        )
        self.retention_days = retention_days or int(os.getenv("OBITUARY_ENGINE_RETENTION_DAYS", "30"))

    def load(self) -> dict:
        if not self.path.exists():
            return {"feed_checkpoints": {}, "processed_obituaries": []}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def save(self, state: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(state, indent=2), encoding="utf-8")

    def prune(self) -> dict:
        state = self.load()
        cutoff = datetime.now(timezone.utc) - timedelta(days=self.retention_days)
        retained = []
        for entry in state.get("processed_obituaries", []):
            processed_at = entry.get("processed_at")
            try:
                parsed = datetime.fromisoformat(processed_at.replace("Z", "+00:00"))
            except (AttributeError, ValueError):
                continue
            if parsed >= cutoff:
                retained.append(entry)
        state["processed_obituaries"] = retained
        self.save(state)
        return state

    def known_fingerprints(self) -> set[str]:
        state = self.prune()
        return {entry["fingerprint"] for entry in state.get("processed_obituaries", []) if entry.get("fingerprint")}

    def record_scan(self, *, source_ids: list[str], fingerprints: list[str], processed_at: str) -> None:
        state = self.prune()
        for source_id in source_ids:
            state.setdefault("feed_checkpoints", {})[source_id] = processed_at
        processed = state.setdefault("processed_obituaries", [])
        processed.extend({"fingerprint": fingerprint, "processed_at": processed_at} for fingerprint in fingerprints)
        self.save(state)
