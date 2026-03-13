from __future__ import annotations

import json
import logging
import os
import sys
from datetime import UTC, datetime
from typing import Any


def get_logger(service: str) -> logging.Logger:
    logger = logging.getLogger(service)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
        logger.propagate = False

    logger.setLevel(getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO))
    return logger


def log_event(logger: logging.Logger, level: int, service: str, event: str, **fields: Any) -> None:
    payload = {
        "timestamp": datetime.now(UTC).isoformat(),
        "level": logging.getLevelName(level).lower(),
        "service": service,
        "event": event,
        **{key: value for key, value in fields.items() if value is not None},
    }
    logger.log(level, json.dumps(payload, sort_keys=True, default=str))
