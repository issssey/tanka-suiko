"""Firestore（Nativeモード）の実装。

- revisionNo はトランザクションで tankas の nextRevisionNo を進めて採番する
- 推敲版の不変性はセキュリティルールで守る（firestore.rules）
- checkRuns と feedback の書き込み、およびすべての削除はサービスアカウント（このサーバー）だけが行う
- 削除中（deletedAt あり）の短歌には書き込まない。ワーカーはトランザクション内で確かめてから書く
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
    def create_tanka(self, author_id: str) -> Tanka:
        ref = self.db.collection("tankas").document()
        now = _now()
        t = Tanka(id=ref.id, authorId=author_id, createdAt=now, updatedAt=now)
        # deletedAt は null で明示しておく（一覧のクエリとセキュリティルールで deletedAt == null を使う）
        ref.set(_dump(t))
        return t

    def get_tanka(self, tanka_id: str) -> Tanka:
        snap = self._tanka(tanka_id).get()
        if not snap.exists:
            raise NotFound(tanka_id)
        return Tanka(id=snap.id, **snap.to_dict())

    def list_tankas_by_author(self, author_id: str) -> list[Tanka]:
        q = (
            self.db.collection("tankas")
            .where(filter=firestore.FieldFilter("authorId", "==", author_id))
            .where(filter=firestore.FieldFilter("deletedAt", "==", None))
            .order_by("updatedAt", direction=firestore.Query.DESCENDING)
        )
        return [Tanka(id=s.id, **s.to_dict()) for s in q.stream()]

    @staticmethod
    def _is_active(snap) -> bool:
        return snap.exists and (snap.to_dict() or {}).get("deletedAt") is None

    # --- revisions ---
    def create_revision(self, tanka_id: str, data: dict[str, Any], reading_memory: dict[str, str]) -> Revision:
        tanka_ref = self._tanka(tanka_id)
        rev_ref = self._revisions(tanka_id).document()
        transaction = self.db.transaction()

        @firestore.transactional
        def run(tx) -> Revision:
            snap = tanka_ref.get(transaction=tx)
            if not self._is_active(snap):
                raise NotFound(tanka_id)
            tanka = snap.to_dict()
            no = int(tanka.get("nextRevisionNo", 1))
            now = _now()
            rev = Revision(id=rev_ref.id, revisionNo=no, createdAt=now, **data)
            tx.create(rev_ref, _dump(rev))
            update: dict[str, Any] = {
                "nextRevisionNo": no + 1,
                "currentRevisionId": rev_ref.id,
                "latestBody": rev.bodyNormalized,
                "latestRevisionNo": no,
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
    def _write_if_active(self, tanka_id: str, ref, data: dict[str, Any]) -> bool:
        """短歌が存在し削除中でないことをトランザクション内で確かめてから書く。

        非同期チェックの実行中に短歌が削除されることがある。確かめずに書くと、
        削除したはずの checkRuns が残ってしまう。
        """
        tanka_ref = self._tanka(tanka_id)
        transaction = self.db.transaction()

        @firestore.transactional
        def run(tx) -> bool:
            if not self._is_active(tanka_ref.get(transaction=tx)):
                return False
            tx.set(ref, data)
            return True

        return run(transaction)

    def add_check_run_if_active(self, tanka_id: str, revision_id: str, run: CheckRun) -> CheckRun | None:
        runs = self._runs(tanka_id, revision_id)
        ref = runs.document(run.id) if run.id else runs.document()
        run = run.model_copy(update={"id": ref.id})
        return run if self._write_if_active(tanka_id, ref, _dump(run)) else None

    def update_check_run_if_active(self, tanka_id: str, revision_id: str, run: CheckRun) -> bool:
        return self._write_if_active(tanka_id, self._runs(tanka_id, revision_id).document(run.id), _dump(run))

    def list_check_runs(self, tanka_id: str, revision_id: str) -> list[CheckRun]:
        q = self._runs(tanka_id, revision_id).order_by("startedAt")
        return [CheckRun(id=s.id, **s.to_dict()) for s in q.stream()]

    # --- feedback ---
    def set_feedback(self, tanka_id: str, feedback: Feedback) -> None:
        ref = self._feedback(tanka_id).document(feedback.fingerprint)
        if not self._write_if_active(tanka_id, ref, feedback.model_dump(mode="python")):
            raise NotFound(tanka_id)

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

    # --- 削除 ---
    def mark_deleted(self, tanka_id: str, at: datetime) -> None:
        ref = self._tanka(tanka_id)
        transaction = self.db.transaction()

        @firestore.transactional
        def run(tx) -> None:
            snap = ref.get(transaction=tx)
            if snap.exists and (snap.to_dict() or {}).get("deletedAt") is None:
                tx.update(ref, {"deletedAt": at})

        run(transaction)

    def purge_tanka(self, tanka_id: str) -> None:
        # Admin SDK（サーバー用クライアント）の再帰削除で、サブコレクションを含めて消す
        self.db.recursive_delete(self._tanka(tanka_id))

    def list_deleted_tankas(self, before: datetime) -> list[str]:
        q = self.db.collection("tankas").where(filter=firestore.FieldFilter("deletedAt", "<", before))
        return [s.id for s in q.stream()]

    def delete_user_data(self, user_id: str) -> None:
        self.db.collection("users").document(user_id).delete()
