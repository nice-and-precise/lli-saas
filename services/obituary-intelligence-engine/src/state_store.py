from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, TypeAlias, TypeVar

from src.logging import get_logger, log_event

StateDict: TypeAlias = dict[str, Any]
LockedResult = TypeVar("LockedResult")

DEFAULT_STATE: StateDict = {"feed_checkpoints": {}, "processed_obituaries": []}


class ObituaryStateStoreError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "state_store_error",
        state_path: str | None = None,
        quarantine_path: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.state_path = state_path
        self.quarantine_path = quarantine_path


class ObituaryStateCorruptionError(ObituaryStateStoreError):
    def __init__(
        self,
        message: str,
        *,
        state_path: str,
        quarantine_path: str | None = None,
    ) -> None:
        super().__init__(
            message,
            code="state_corruption",
            state_path=state_path,
            quarantine_path=quarantine_path,
        )


class ObituaryStateLockError(ObituaryStateStoreError):
    def __init__(self, message: str, *, state_path: str) -> None:
        super().__init__(message, code="state_lock_timeout", state_path=state_path)


def _validate_state_shape(state: StateDict) -> None:
    if not isinstance(state, dict):
        raise ValueError("state must be an object")

    checkpoints = state.get("feed_checkpoints", {})
    processed = state.get("processed_obituaries", [])

    if not isinstance(checkpoints, dict):
        raise ValueError("feed_checkpoints must be an object")
    if not isinstance(processed, list):
        raise ValueError("processed_obituaries must be an array")

    for source_id, processed_at in checkpoints.items():
        if not isinstance(source_id, str) or not source_id.strip():
            raise ValueError("feed_checkpoints keys must be non-empty strings")
        if processed_at is not None and not isinstance(processed_at, str):
            raise ValueError("feed_checkpoints values must be strings or null")

    for index, entry in enumerate(processed):
        if not isinstance(entry, dict):
            raise ValueError(f"processed_obituaries[{index}] must be an object")
        fingerprint = entry.get("fingerprint")
        processed_at = entry.get("processed_at")
        if fingerprint is not None and not isinstance(fingerprint, str):
            raise ValueError(f"processed_obituaries[{index}].fingerprint must be a string or null")
        if processed_at is not None and not isinstance(processed_at, str):
            raise ValueError(f"processed_obituaries[{index}].processed_at must be a string or null")


class ObituaryStateStore:
    def __init__(
        self,
        path: str | None = None,
        retention_days: int | None = None,
        *,
        lock_timeout_seconds: float = 5.0,
        lock_retry_seconds: float = 0.05,
        lock_stale_seconds: float = 30.0,
        logger: logging.Logger | None = None,
    ) -> None:
        self.path = Path(
            path
            or os.getenv("OBITUARY_ENGINE_STATE_PATH")
            or "/var/lib/lli-saas/obituary-intelligence-engine/state.json"
        )
        self.retention_days = retention_days or int(os.getenv("OBITUARY_ENGINE_RETENTION_DAYS", "30"))
        self.lock_timeout_seconds = lock_timeout_seconds
        self.lock_retry_seconds = lock_retry_seconds
        self.lock_stale_seconds = lock_stale_seconds
        self.lock_path = self.path.with_name(f"{self.path.name}.lock")
        self.logger = logger or get_logger("obituary-intelligence-engine")

    def load(self) -> StateDict:
        return self._load_unlocked()

    def save(self, state: StateDict) -> None:
        self._validate_state(state)
        self._with_lock(lambda: self._write_state(state))

    def prune(self) -> StateDict:
        cutoff = datetime.now(UTC) - timedelta(days=self.retention_days)

        def mutate(state: StateDict) -> StateDict:
            retained: list[StateDict] = []
            for entry in state.get("processed_obituaries", []):
                processed_at = entry.get("processed_at")
                try:
                    parsed = datetime.fromisoformat(processed_at.replace("Z", "+00:00"))
                except (AttributeError, ValueError):
                    continue
                if parsed >= cutoff:
                    retained.append(entry)
            state["processed_obituaries"] = retained
            return state

        return self._update_locked(mutate)

    def known_fingerprints(self) -> set[str]:
        state = self.prune()
        return {
            entry["fingerprint"]
            for entry in state.get("processed_obituaries", [])
            if entry.get("fingerprint")
        }

    def record_scan(self, *, source_ids: list[str], fingerprints: list[str], processed_at: str) -> None:
        def mutate(state: StateDict) -> StateDict:
            cutoff = datetime.now(UTC) - timedelta(days=self.retention_days)
            retained: list[StateDict] = []
            for entry in state.get("processed_obituaries", []):
                current_processed_at = entry.get("processed_at")
                try:
                    parsed = datetime.fromisoformat(current_processed_at.replace("Z", "+00:00"))
                except (AttributeError, ValueError):
                    continue
                if parsed >= cutoff:
                    retained.append(entry)

            for source_id in source_ids:
                state.setdefault("feed_checkpoints", {})[source_id] = processed_at
            retained.extend(
                {"fingerprint": fingerprint, "processed_at": processed_at}
                for fingerprint in fingerprints
            )
            state["processed_obituaries"] = retained
            return state

        self._update_locked(mutate)

    def _validate_state(self, state: StateDict) -> None:
        try:
            _validate_state_shape(state)
        except ValueError as exc:
            raise ObituaryStateStoreError(
                f"Invalid obituary state document for {self.path}: {exc}",
                code="invalid_state_document",
                state_path=str(self.path),
            ) from exc

    def _load_unlocked(self) -> StateDict:
        if not self.path.exists():
            state = DEFAULT_STATE.copy()
            log_event(
                self.logger,
                logging.INFO,
                "obituary-intelligence-engine",
                "obituary_state_load_succeeded",
                state_path=str(self.path),
                checkpoint_count=0,
                processed_count=0,
                default_state=True,
            )
            return state

        try:
            with self.path.open("r", encoding="utf-8") as handle:
                state = json.load(handle)
            if not isinstance(state, dict):
                raise ValueError("state must be an object")
            _validate_state_shape(state)
            normalized: StateDict = {
                "feed_checkpoints": dict(state.get("feed_checkpoints", {})),
                "processed_obituaries": list(state.get("processed_obituaries", [])),
            }
            log_event(
                self.logger,
                logging.INFO,
                "obituary-intelligence-engine",
                "obituary_state_load_succeeded",
                state_path=str(self.path),
                checkpoint_count=len(normalized.get("feed_checkpoints", {})),
                processed_count=len(normalized.get("processed_obituaries", [])),
            )
            return normalized
        except (json.JSONDecodeError, ValueError) as exc:
            raise self._handle_corruption(exc) from exc
        except OSError as exc:
            log_event(
                self.logger,
                logging.ERROR,
                "obituary-intelligence-engine",
                "obituary_state_load_failed",
                state_path=str(self.path),
                error=str(exc),
            )
            raise

    def _handle_corruption(self, exc: Exception) -> ObituaryStateCorruptionError:
        quarantine_path = f"{self.path}.corrupt-{int(time.time() * 1000)}"
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if self.path.exists():
                shutil.copyfile(self.path, quarantine_path)
        except OSError as copy_error:
            log_event(
                self.logger,
                logging.ERROR,
                "obituary-intelligence-engine",
                "obituary_state_quarantine_failed",
                state_path=str(self.path),
                quarantine_path=quarantine_path,
                error=str(copy_error),
            )

        log_event(
            self.logger,
            logging.ERROR,
            "obituary-intelligence-engine",
            "obituary_state_corruption_detected",
            state_path=str(self.path),
            quarantine_path=quarantine_path,
            error=str(exc),
        )
        return ObituaryStateCorruptionError(
            (
                f"Obituary engine state is corrupt at {self.path}. "
                "Restore the file from backup or replace it with a valid JSON document."
            ),
            state_path=str(self.path),
            quarantine_path=quarantine_path,
        )

    def _write_state(self, state: StateDict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp_fd, temp_path = tempfile.mkstemp(prefix=f"{self.path.name}.tmp-", dir=self.path.parent)
        try:
            with os.fdopen(temp_fd, "w", encoding="utf-8") as handle:
                json.dump(state, handle, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, self.path)
            self._fsync_directory()
            log_event(
                self.logger,
                logging.INFO,
                "obituary-intelligence-engine",
                "obituary_state_write_succeeded",
                state_path=str(self.path),
                checkpoint_count=len(state.get("feed_checkpoints", {})),
                processed_count=len(state.get("processed_obituaries", [])),
            )
        except OSError as exc:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
            log_event(
                self.logger,
                logging.ERROR,
                "obituary-intelligence-engine",
                "obituary_state_write_failed",
                state_path=str(self.path),
                error=str(exc),
            )
            raise

    def _fsync_directory(self) -> None:
        try:
            directory_fd = os.open(str(self.path.parent), os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def _update_locked(self, update_fn: Callable[[StateDict], StateDict]) -> StateDict:
        def runner() -> StateDict:
            state = self._load_unlocked()
            next_state = update_fn(state)
            self._validate_state(next_state)
            self._write_state(next_state)
            return next_state

        return self._with_lock(runner)

    def _with_lock(self, fn: Callable[[], LockedResult]) -> LockedResult:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        started_at = time.monotonic()

        while time.monotonic() - started_at < self.lock_timeout_seconds:
            try:
                lock_fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                try:
                    if time.time() - self.lock_path.stat().st_mtime > self.lock_stale_seconds:
                        self.lock_path.unlink()
                        log_event(
                            self.logger,
                            logging.WARNING,
                            "obituary-intelligence-engine",
                            "obituary_state_lock_stale_reaped",
                            lock_path=str(self.lock_path),
                        )
                        continue
                except FileNotFoundError:
                    continue

                time.sleep(self.lock_retry_seconds)
                continue

            try:
                with os.fdopen(lock_fd, "w", encoding="utf-8") as handle:
                    json.dump({"pid": os.getpid(), "locked_at": datetime.now(UTC).isoformat()}, handle)
                    handle.flush()
                return fn()
            finally:
                try:
                    self.lock_path.unlink()
                except FileNotFoundError:
                    pass

        log_event(
            self.logger,
            logging.ERROR,
            "obituary-intelligence-engine",
            "obituary_state_lock_failed",
            state_path=str(self.path),
            lock_path=str(self.lock_path),
        )
        raise ObituaryStateLockError(
            f"Timed out waiting for obituary state lock at {self.lock_path}",
            state_path=str(self.path),
        )
