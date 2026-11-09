"""メモリ上の実装（テスト・ローカル開発用）。"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from typing import Any

from ..models import MAX_DESTINATIONS, Appreciation, CheckRun, Feedback, Publication, Revision, Sequence, Tanka
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
        self.usage: dict[tuple[str, str, str], int] = {}
        self.appreciations: dict[str, dict[str, Appreciation]] = {}
        self.users: set[str] = set()
        self.sequences: dict[str, Sequence] = {}
        self.publications: dict[str, Publication] = {}
        self.destinations: dict[str, list[str]] = {}

    def _active(self, tanka_id: str) -> bool:
        t = self.tankas.get(tanka_id)
        return t is not None and t.deletedAt is None

    def create_tanka(self, author_id: str) -> Tanka:
        with self._lock:
            now = _now()
            t = Tanka(id=f"t_{uuid.uuid4().hex[:12]}", authorId=author_id, createdAt=now, updatedAt=now)
            self.tankas[t.id] = t
            self.revisions[t.id] = {}
            self.feedback[t.id] = {}
            return t.model_copy(deep=True)

    def get_tanka(self, tanka_id: str) -> Tanka:
        with self._lock:
            if tanka_id not in self.tankas:
                raise NotFound(tanka_id)
            return self.tankas[tanka_id].model_copy(deep=True)

    def list_tankas_by_author(self, author_id: str) -> list[Tanka]:
        with self._lock:
            ts = [t for t in self.tankas.values() if t.authorId == author_id and t.deletedAt is None]
            return [t.model_copy(deep=True) for t in sorted(ts, key=lambda t: t.updatedAt, reverse=True)]

    def create_revision(self, tanka_id: str, data: dict[str, Any], reading_memory: dict[str, str]) -> Revision:
        with self._lock:
            if not self._active(tanka_id):
                raise NotFound(tanka_id)
            tanka = self.tankas[tanka_id]
            no = tanka.nextRevisionNo
            rev = Revision(id=f"r_{uuid.uuid4().hex[:12]}", revisionNo=no, createdAt=_now(), **data)
            self.revisions[tanka_id][rev.id] = rev
            tanka.nextRevisionNo = no + 1
            tanka.currentRevisionId = rev.id
            tanka.latestBody = rev.bodyNormalized
            tanka.latestRevisionNo = no
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

    def add_check_run_if_active(self, tanka_id: str, revision_id: str, run: CheckRun) -> CheckRun | None:
        with self._lock:
            if not self._active(tanka_id):
                return None
            run = run.model_copy(update={"id": run.id or f"c_{uuid.uuid4().hex[:12]}"}, deep=True)
            self.runs.setdefault((tanka_id, revision_id), {})[run.id] = run
            return run.model_copy(deep=True)

    def update_check_run_if_active(self, tanka_id: str, revision_id: str, run: CheckRun) -> bool:
        with self._lock:
            if not self._active(tanka_id):
                return False
            self.runs.setdefault((tanka_id, revision_id), {})[run.id] = run.model_copy(deep=True)
            return True

    def list_check_runs(self, tanka_id: str, revision_id: str) -> list[CheckRun]:
        with self._lock:
            runs = self.runs.get((tanka_id, revision_id), {}).values()
            return [r.model_copy(deep=True) for r in sorted(runs, key=lambda r: r.startedAt)]

    def set_feedback(self, tanka_id: str, feedback: Feedback) -> None:
        with self._lock:
            if not self._active(tanka_id):
                raise NotFound(tanka_id)
            self.feedback.setdefault(tanka_id, {})[feedback.fingerprint] = feedback.model_copy(deep=True)

    def delete_feedback(self, tanka_id: str, fingerprint: str) -> None:
        with self._lock:
            self.feedback.get(tanka_id, {}).pop(fingerprint, None)

    def list_feedback(self, tanka_id: str) -> list[Feedback]:
        with self._lock:
            return [f.model_copy(deep=True) for f in self.feedback.get(tanka_id, {}).values()]

    def increment_daily_usage(self, user_id: str, day: str, field: str = "asyncChecks") -> int:
        with self._lock:
            self.users.add(user_id)
            key = (user_id, field, day)
            self.usage[key] = self.usage.get(key, 0) + 1
            return self.usage[key]

    # --- 鑑賞 ---
    def get_appreciation(self, tanka_id: str, revision_id: str) -> Appreciation | None:
        with self._lock:
            a = self.appreciations.get(tanka_id, {}).get(revision_id)
            return a.model_copy(deep=True) if a else None

    def create_appreciation_if_absent(self, tanka_id: str, appreciation: Appreciation,
                                      replace_failed: bool = False) -> tuple[Appreciation, bool]:
        with self._lock:
            if not self._active(tanka_id):
                raise NotFound(tanka_id)
            bucket = self.appreciations.setdefault(tanka_id, {})
            existing = bucket.get(appreciation.revisionId)
            if existing is not None and not (replace_failed and existing.status == "failed"):
                return existing.model_copy(deep=True), False
            bucket[appreciation.revisionId] = appreciation.model_copy(deep=True)
            return appreciation.model_copy(deep=True), True

    def update_appreciation_if_active(self, tanka_id: str, appreciation: Appreciation) -> bool:
        with self._lock:
            if not self._active(tanka_id):
                return False
            self.appreciations.setdefault(tanka_id, {})[appreciation.revisionId] = appreciation.model_copy(deep=True)
            return True

    def set_appreciation_note(self, tanka_id: str, revision_id: str, note: str | None, at: datetime) -> Appreciation:
        with self._lock:
            a = self.appreciations.get(tanka_id, {}).get(revision_id)
            if not self._active(tanka_id) or a is None:
                raise NotFound(revision_id)
            a.authorNote = note
            a.updatedAt = at
            return a.model_copy(deep=True)

    def list_appreciations(self, tanka_id: str) -> list[Appreciation]:
        with self._lock:
            return [a.model_copy(deep=True) for a in self.appreciations.get(tanka_id, {}).values()]

    def mark_deleted(self, tanka_id: str, at: datetime) -> None:
        with self._lock:
            t = self.tankas.get(tanka_id)
            if t is not None and t.deletedAt is None:
                t.deletedAt = at

    def purge_tanka(self, tanka_id: str) -> None:
        with self._lock:
            self.tankas.pop(tanka_id, None)
            self.revisions.pop(tanka_id, None)
            self.feedback.pop(tanka_id, None)
            self.appreciations.pop(tanka_id, None)
            for key in [k for k in self.runs if k[0] == tanka_id]:
                del self.runs[key]

    def list_deleted_tankas(self, before: datetime) -> list[str]:
        with self._lock:
            return [t.id for t in self.tankas.values() if t.deletedAt is not None and t.deletedAt < before]

    def delete_user_data(self, user_id: str) -> None:
        with self._lock:
            self.users.discard(user_id)
            for key in [k for k in self.usage if k[0] == user_id]:
                del self.usage[key]
            self.destinations.pop(user_id, None)

    # --- 連作 ---
    def _set_sequence_ids(self, tanka_ids: set[str], seq_id: str, add: bool) -> None:
        for tid in tanka_ids:
            t = self.tankas.get(tid)
            if t is None or t.deletedAt is not None:
                continue
            if add and seq_id not in t.sequenceIds:
                t.sequenceIds.append(seq_id)
            if not add and seq_id in t.sequenceIds:
                t.sequenceIds.remove(seq_id)

    def create_sequence(self, seq: Sequence) -> Sequence:
        with self._lock:
            ids = {i.tankaId for i in seq.items}
            if not all(self._active(t) for t in ids):
                raise NotFound("tanka")
            seq = seq.model_copy(update={"id": seq.id or f"s_{uuid.uuid4().hex[:12]}"}, deep=True)
            self.sequences[seq.id] = seq
            self._set_sequence_ids(ids, seq.id, add=True)
            return seq.model_copy(deep=True)

    def update_sequence(self, seq: Sequence) -> Sequence:
        with self._lock:
            old = self.sequences.get(seq.id)
            if old is None:
                raise NotFound(seq.id)
            before = {i.tankaId for i in old.items}
            after = {i.tankaId for i in seq.items}
            if not all(self._active(t) for t in after - before):
                raise NotFound("tanka")
            self.sequences[seq.id] = seq.model_copy(deep=True)
            self._set_sequence_ids(before - after, seq.id, add=False)
            self._set_sequence_ids(after - before, seq.id, add=True)
            return seq.model_copy(deep=True)

    def delete_sequence(self, sequence_id: str) -> None:
        with self._lock:
            old = self.sequences.pop(sequence_id, None)
            if old is not None:
                self._set_sequence_ids({i.tankaId for i in old.items}, sequence_id, add=False)

    def get_sequence(self, sequence_id: str) -> Sequence:
        with self._lock:
            if sequence_id not in self.sequences:
                raise NotFound(sequence_id)
            return self.sequences[sequence_id].model_copy(deep=True)

    def list_sequences_by_author(self, author_id: str) -> list[Sequence]:
        with self._lock:
            ss = [s for s in self.sequences.values() if s.authorId == author_id]
            return [s.model_copy(deep=True) for s in sorted(ss, key=lambda s: s.updatedAt, reverse=True)]

    def remove_tanka_from_sequence(self, sequence_id: str, tanka_id: str) -> None:
        with self._lock:
            seq = self.sequences.get(sequence_id)
            if seq is None:
                return
            seq.items = [i for i in seq.items if i.tankaId != tanka_id]
            seq.updatedAt = _now()
            t = self.tankas.get(tanka_id)
            if t is not None and sequence_id in t.sequenceIds:
                t.sequenceIds.remove(sequence_id)

    # --- 発表記録 ---
    def _touch_destination(self, user_id: str, destination: str) -> None:
        rest = [d for d in self.destinations.get(user_id, []) if d != destination]
        self.destinations[user_id] = [destination, *rest][:MAX_DESTINATIONS]

    def _add_published(self, tanka_ids: list[str], delta: int) -> None:
        for tid in set(tanka_ids):
            t = self.tankas.get(tid)
            if t is not None and t.deletedAt is None:
                t.publishedCount = max(0, t.publishedCount + delta)

    def create_publication(self, pub: Publication) -> Publication:
        with self._lock:
            pub = pub.model_copy(update={"id": pub.id or f"p_{uuid.uuid4().hex[:12]}"}, deep=True)
            self.publications[pub.id] = pub
            self._add_published(pub.tankaIds, 1)
            self._touch_destination(pub.authorId, pub.destination)
            return pub.model_copy(deep=True)

    def update_publication(self, pub: Publication) -> Publication:
        with self._lock:
            if pub.id not in self.publications:
                raise NotFound(pub.id)
            self.publications[pub.id] = pub.model_copy(deep=True)
            self._touch_destination(pub.authorId, pub.destination)
            return pub.model_copy(deep=True)

    def delete_publication(self, publication_id: str) -> None:
        with self._lock:
            old = self.publications.pop(publication_id, None)
            if old is not None:
                self._add_published(old.tankaIds, -1)

    def get_publication(self, publication_id: str) -> Publication:
        with self._lock:
            if publication_id not in self.publications:
                raise NotFound(publication_id)
            return self.publications[publication_id].model_copy(deep=True)

    def _sorted_pubs(self, pubs) -> list[Publication]:
        return [p.model_copy(deep=True) for p in sorted(pubs, key=lambda p: (p.submittedOn, p.createdAt), reverse=True)]

    def list_publications_by_author(self, author_id: str) -> list[Publication]:
        with self._lock:
            return self._sorted_pubs(p for p in self.publications.values() if p.authorId == author_id)

    def list_publications_by_tanka(self, author_id: str, tanka_id: str) -> list[Publication]:
        with self._lock:
            return self._sorted_pubs(
                p for p in self.publications.values() if p.authorId == author_id and tanka_id in p.tankaIds
            )

    def get_destinations(self, user_id: str) -> list[str]:
        with self._lock:
            return list(self.destinations.get(user_id, []))
