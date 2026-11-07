"""Firestore（Nativeモード）の実装。

- revisionNo はトランザクションで tankas の nextRevisionNo を進めて採番する
- 推敲版の不変性はセキュリティルールで守る（firestore.rules）
- checkRuns と feedback の書き込みはサービスアカウント（このサーバー）だけが行う
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from google.cloud import firestore

from ..models import CheckRun, Feedback, Revision, Tanka
from .base import NotFound


def _now() -> datetime:
    return datetime.now(UTC)


def _dump(model) -> dict[str, Any]:
    data = model.model_dump(mode="python", exclude={"id"})
    return _tuples_to_lists(data)


def _tuples_to_lists(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _tuples_to_lists(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_tuples_to_lists(v) for v in value]
    return value


class FirestoreRepository:
    def __init__(self, client: firestore.Client | None = None) -> None:
        self.db = client or firestore.Client()

    # --- paths ---
    def _tanka(self, tanka_id: str):
        return self.db.collection("tankas").document(tanka_id)

    def _revisions(self, tanka_id: str):
        return self._tanka(tanka_id).collection("revisions")

    def _runs(self, tanka_id: str, revision_id: str):
        return self._revisions(tanka_id).document(revision_id).collection("checkRuns")

    def _feedback(self, tanka_id: str):
        return self._tanka(tanka_id).collection("feedback")

    # --- tankas ---
    def create_tanka(self, author_id: str, title: str | None) -> Tanka:
        ref = self.db.collection("tankas").document()
        now = _now()
        t = Tanka(id=ref.id, authorId=author_id, title=title, createdAt=now, updatedAt=now)
        ref.set(_dump(t))
        return t

    def get_tanka(self, tanka_id: str) -> Tanka:
        snap = self._tanka(tanka_id).get()
        if not snap.exists:
            raise NotFound(tanka_id)
        return Tanka(id=snap.id, **snap.to_dict())

    # --- revisions ---
    def create_revision(self, tanka_id: str, data: dict[str, Any], reading_memory: dict[str, str]) -> Revision:
        tanka_ref = self._tanka(tanka_id)
        rev_ref = self._revisions(tanka_id).document()
        transaction = self.db.transaction()

        @firestore.transactional
        def run(tx) -> Revision:
            snap = tanka_ref.get(transaction=tx)
            if not snap.exists:
                raise NotFound(tanka_id)
            tanka = snap.to_dict()
            no = int(tanka.get("nextRevisionNo", 1))
            now = _now()
            rev = Revision(id=rev_ref.id, revisionNo=no, createdAt=now, **data)
            tx.create(rev_ref, _dump(rev))
            update: dict[str, Any] = {
                "nextRevisionNo": no + 1,
                "currentRevisionId": rev_ref.id,
                "updatedAt": now,
            }
            for surface, reading in reading_memory.items():
                update[firestore.FieldPath(["readingMemory", surface]).to_api_repr()] = reading
            tx.update(tanka_ref, update)
            return rev

        return run(transaction)

    def get_revision(self, tanka_id: str, revision_id: str) -> Revision:
        snap = self._revisions(tanka_id).document(revision_id).get()
        if not snap.exists:
            raise NotFound(revision_id)
        return Revision(id=snap.id, **snap.to_dict())

    def list_revisions(self, tanka_id: str) -> list[Revision]:
        q = self._revisions(tanka_id).order_by("revisionNo")
        return [Revision(id=s.id, **s.to_dict()) for s in q.stream()]

    # --- checkRuns ---
    def add_check_run(self, tanka_id: str, revision_id: str, run: CheckRun) -> CheckRun:
        ref = self._runs(tanka_id, revision_id).document(run.id) if run.id else self._runs(tanka_id, revision_id).document()
        run = run.model_copy(update={"id": ref.id})
        ref.set(_dump(run))
        return run

    def update_check_run(self, tanka_id: str, revision_id: str, run: CheckRun) -> None:
        self._runs(tanka_id, revision_id).document(run.id).set(_dump(run))

    def list_check_runs(self, tanka_id: str, revision_id: str) -> list[CheckRun]:
        q = self._runs(tanka_id, revision_id).order_by("startedAt")
        return [CheckRun(id=s.id, **s.to_dict()) for s in q.stream()]

    # --- feedback ---
    def set_feedback(self, tanka_id: str, feedback: Feedback) -> None:
        self._feedback(tanka_id).document(feedback.fingerprint).set(feedback.model_dump(mode="python"))

    def delete_feedback(self, tanka_id: str, fingerprint: str) -> None:
        self._feedback(tanka_id).document(fingerprint).delete()

    def list_feedback(self, tanka_id: str) -> list[Feedback]:
        return [Feedback(**s.to_dict()) for s in self._feedback(tanka_id).stream()]

    # --- usage ---
    def increment_daily_usage(self, user_id: str, day: str) -> int:
        ref = self.db.collection("users").document(user_id)
        transaction = self.db.transaction()

        @firestore.transactional
        def run(tx) -> int:
            snap = ref.get(transaction=tx)
            usage = (snap.to_dict() or {}).get("asyncChecks", {}) if snap.exists else {}
            count = int(usage.get(day, 0)) + 1
            # その日の分だけを残す（前日以前の回数は不要）
            tx.set(ref, {"asyncChecks": {day: count}}, merge=False)
            return count

        return run(transaction)
