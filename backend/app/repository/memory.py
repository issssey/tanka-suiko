"""メモリ上の実装（テスト・ローカル開発用）。"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from typing import Any

from ..models import CheckRun, Feedback, Revision, Tanka
from .base import NotFound


def _now() -> datetime:
    return datetime.now(UTC)


class MemoryRepository:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.tankas: dict[str, Tanka] = {}
        self.revisions: dict[str, dict[str, Revision]] = {}
        self.runs: dict[tuple[str, str], dict[str, CheckRun]] = {}
        self.feedback: dict[str, dict[str, Feedback]] = {}
        self.usage: dict[tuple[str, str], int] = {}

    def create_tanka(self, author_id: str, title: str | None) -> Tanka:
        with self._lock:
            now = _now()
            t = Tanka(id=f"t_{uuid.uuid4().hex[:12]}", authorId=author_id, title=title, createdAt=now, updatedAt=now)
            self.tankas[t.id] = t
            self.revisions[t.id] = {}
            self.feedback[t.id] = {}
            return t.model_copy(deep=True)

    def get_tanka(self, tanka_id: str) -> Tanka:
        with self._lock:
            if tanka_id not in self.tankas:
                raise NotFound(tanka_id)
            return self.tankas[tanka_id].model_copy(deep=True)

    def create_revision(self, tanka_id: str, data: dict[str, Any], reading_memory: dict[str, str]) -> Revision:
        with self._lock:
            tanka = self.tankas.get(tanka_id)
            if tanka is None:
                raise NotFound(tanka_id)
            no = tanka.nextRevisionNo
            rev = Revision(id=f"r_{uuid.uuid4().hex[:12]}", revisionNo=no, createdAt=_now(), **data)
            self.revisions[tanka_id][rev.id] = rev
            tanka.nextRevisionNo = no + 1
            tanka.currentRevisionId = rev.id
            tanka.updatedAt = rev.createdAt
            tanka.readingMemory = {**tanka.readingMemory, **reading_memory}
            return rev.model_copy(deep=True)

    def get_revision(self, tanka_id: str, revision_id: str) -> Revision:
        with self._lock:
            try:
                return self.revisions[tanka_id][revision_id].model_copy(deep=True)
            except KeyError as e:
                raise NotFound(revision_id) from e

    def list_revisions(self, tanka_id: str) -> list[Revision]:
        with self._lock:
            revs = self.revisions.get(tanka_id, {}).values()
            return [r.model_copy(deep=True) for r in sorted(revs, key=lambda r: r.revisionNo)]

    def add_check_run(self, tanka_id: str, revision_id: str, run: CheckRun) -> CheckRun:
        with self._lock:
            run = run.model_copy(update={"id": run.id or f"c_{uuid.uuid4().hex[:12]}"}, deep=True)
            self.runs.setdefault((tanka_id, revision_id), {})[run.id] = run
            return run.model_copy(deep=True)

    def update_check_run(self, tanka_id: str, revision_id: str, run: CheckRun) -> None:
        with self._lock:
            self.runs.setdefault((tanka_id, revision_id), {})[run.id] = run.model_copy(deep=True)

    def list_check_runs(self, tanka_id: str, revision_id: str) -> list[CheckRun]:
        with self._lock:
            runs = self.runs.get((tanka_id, revision_id), {}).values()
            return [r.model_copy(deep=True) for r in sorted(runs, key=lambda r: r.startedAt)]

    def set_feedback(self, tanka_id: str, feedback: Feedback) -> None:
        with self._lock:
            self.feedback.setdefault(tanka_id, {})[feedback.fingerprint] = feedback.model_copy(deep=True)

    def delete_feedback(self, tanka_id: str, fingerprint: str) -> None:
        with self._lock:
            self.feedback.get(tanka_id, {}).pop(fingerprint, None)

    def list_feedback(self, tanka_id: str) -> list[Feedback]:
        with self._lock:
            return [f.model_copy(deep=True) for f in self.feedback.get(tanka_id, {}).values()]

    def increment_daily_usage(self, user_id: str, day: str) -> int:
        with self._lock:
            key = (user_id, day)
            self.usage[key] = self.usage.get(key, 0) + 1
            return self.usage[key]
