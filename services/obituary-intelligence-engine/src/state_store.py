from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

DEFAULT_STATE_PATH = "/var/lib/lli-saas/obituary-intelligence-engine/state.json"
DEFAULT_KV_KEY = "obituary-engine:state"


class StateBackend(Protocol):
    """Storage primitive: read returns the stored dict or None; write persists it."""

    label: str

    def read(self) -> dict | None: ...

    def write(self, state: dict) -> None: ...


class FileStateBackend:
    """Local/dev/test backend backed by a JSON file on disk."""

    def __init__(self, path: str | None = None) -> None:
        self.path = Path(path or os.getenv("OBITUARY_ENGINE_STATE_PATH") or DEFAULT_STATE_PATH)
        # A non-sensitive backend name for health/ready; the actual filesystem path
        # stays internal (kept on `.path`) and is not exposed over HTTP.
        self.label = "file"

    def read(self) -> dict | None:
        if not self.path.exists():
            return None
        return json.loads(self.path.read_text(encoding="utf-8"))

    def write(self, state: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(state, indent=2), encoding="utf-8")


class KvStateBackend:
    """Production backend for Vercel (no persistent FS) backed by Upstash Redis.

    Uses the Upstash REST command API over `requests` (already a dependency),
    reading KV_REST_API_URL / KV_REST_API_TOKEN injected by the Vercel KV
    marketplace integration. State is stored as a single JSON string value.
    """

    def __init__(self, key: str | None = None) -> None:
        self.key = key or os.getenv("OBITUARY_ENGINE_KV_KEY") or DEFAULT_KV_KEY
        self.label = "kv"
        self._url = os.environ["KV_REST_API_URL"].rstrip("/")
        self._token = os.environ["KV_REST_API_TOKEN"]

    def _command(self, command: list) -> dict:
        import requests

        response = requests.post(
            self._url,
            headers={"Authorization": f"Bearer {self._token}"},
            json=command,
            timeout=10,
        )
        response.raise_for_status()
        return response.json()

    def read(self) -> dict | None:
        result = self._command(["GET", self.key]).get("result")
        if result is None:
            return None
        return json.loads(result)

    def write(self, state: dict) -> None:
        self._command(["SET", self.key, json.dumps(state)])


def _create_backend(path: str | None) -> StateBackend:
    backend = (os.getenv("STATE_STORE_BACKEND") or "file").lower()
    if backend == "kv":
        return KvStateBackend()
    return FileStateBackend(path)


class ObituaryStateStore:
    """Feed checkpoints + processed-obituary fingerprints with retention pruning.

    Persistence is delegated to a swappable backend (file by default, KV on
    Vercel) so the higher-level logic here is storage-agnostic.
    """

    def __init__(
        self,
        path: str | None = None,
        retention_days: int | None = None,
        backend: StateBackend | None = None,
    ) -> None:
        self.backend = backend or _create_backend(path)
        # Preserve `.path` for the file backend (used by the service's /ready
        # endpoint); None when running on a non-filesystem backend.
        self.path = getattr(self.backend, "path", None)
        self.retention_days = retention_days or int(os.getenv("OBITUARY_ENGINE_RETENTION_DAYS", "30"))

    def load(self) -> dict:
        return self.backend.read() or {"feed_checkpoints": {}, "processed_obituaries": []}

    def save(self, state: dict) -> None:
        self.backend.write(state)

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
