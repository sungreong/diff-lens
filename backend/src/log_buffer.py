"""Small in-process log buffer for the local debug console."""

from __future__ import annotations

import logging
import re
from collections import deque
from datetime import datetime
from threading import RLock
from typing import Any, Dict, List, Optional


_SECRET_PATTERNS = [
    re.compile(r"(?i)(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;]+"),
    re.compile(r"(?i)((?:api[_-]?key|token|secret|password|private[_-]?token)\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"(?i)((?:openai|gitlab|langfuse)[_-]?(?:key|token|secret)\s*[:=]\s*)[^\s,;]+"),
]


def redact_log_text(value: Any) -> str:
    text = str(value)
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(lambda match: f"{match.group(1)}[REDACTED]", text)
    return text


class RingBufferLogHandler(logging.Handler):
    def __init__(self, capacity: int = 500) -> None:
        super().__init__()
        self.records = deque(maxlen=capacity)
        self.lock = RLock()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            payload = {
                "timestamp": datetime.fromtimestamp(record.created).isoformat(timespec="seconds"),
                "level": record.levelname,
                "logger": record.name,
                "message": redact_log_text(record.getMessage()),
                "source": "runtime",
            }
            with self.lock:
                self.records.append(payload)
        except Exception:
            self.handleError(record)

    def recent(self, *, limit: int = 200, level: Optional[str] = None) -> List[Dict[str, str]]:
        level_name = (level or "").upper()
        with self.lock:
            items = list(self.records)
        if level_name and level_name != "ALL":
            items = [item for item in items if item.get("level") == level_name]
        return items[-limit:]


_handler: Optional[RingBufferLogHandler] = None


def install_log_buffer(capacity: int = 500) -> RingBufferLogHandler:
    global _handler
    if _handler is not None:
        return _handler

    handler = RingBufferLogHandler(capacity=capacity)
    handler.setLevel(logging.DEBUG)
    logging.getLogger().addHandler(handler)
    _handler = handler
    return handler


def get_recent_runtime_logs(*, limit: int = 200, level: Optional[str] = None) -> List[Dict[str, str]]:
    if _handler is None:
        return []
    return _handler.recent(limit=limit, level=level)
