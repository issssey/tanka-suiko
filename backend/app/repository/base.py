"""永続化のインターフェース。本番は Firestore、テストとローカル開発はメモリを使う。

パス（Firestore）:
  users/{uid}                                   … 1日の非同期チェック回数（usage）
  tankas/{tankaId}                              … 題は持たない。latestBody で一覧を描く
    revisions/{revisionId}                      … 保存後は変更しない
      checkRuns/{runId}                         … findings を配列で持つ
    feedback/{fingerprint}                      … 作者の判断（短歌単位）
    appreciations/{revisionId}                  … 鑑賞（1稿1件。稿とは別のドキュメント）
  notes/{noteId}                                … 気づき。tankas.sourceNoteId と tankaIds を同じトランザクションで結ぶ
  sequences/{sequenceId}                        … 連作。tankas.sequenceIds を同じトランザクションで更新
  publications/{publicationId}                  … 発表記録。tankas.publishedCount と users.destinations も同時に更新

削除は短歌単位のみ。deletedAt を立ててから配下をまとめて消す。
削除中・削除済みの短歌には書き込まない（*_if_active はトランザクションで確かめてから書く）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from ..models import Appreciation, CheckRun, Note, Feedback, Publication, Revision, Sequence, Tanka


class NotFound(LookupError):
    pass


class Repository(Protocol):
    def create_tanka(self, author_id: str) -> Tanka: ...

    def get_tanka(self, tanka_id: str) -> Tanka:
        """削除中（deletedAt あり）の短歌も返す。存在しなければ NotFound。"""
        ...

    def list_tankas_by_author(self, author_id: str) -> list[Tanka]:
        """削除中のものを除き、updatedAt の新しい順に返す。"""
        ...

    def create_revision(self, tanka_id: str, data: dict[str, Any], reading_memory: dict[str, str]) -> Revision:
        """revisionNo をトランザクションで採番して推敲版を保存し、短歌の currentRevisionId・latestBody・
        latestRevisionNo を進める。短歌が削除中なら NotFound。"""
        ...

    def get_revision(self, tanka_id: str, revision_id: str) -> Revision: ...

    def list_revisions(self, tanka_id: str) -> list[Revision]: ...

    def add_check_run_if_active(self, tanka_id: str, revision_id: str, run: CheckRun) -> CheckRun | None:
        """短歌が存在し削除中でなければ追加して返す。そうでなければ書かずに None。"""
        ...

    def update_check_run_if_active(self, tanka_id: str, revision_id: str, run: CheckRun) -> bool:
        """短歌が存在し削除中でなければ書いて True。そうでなければ書かずに False。"""
        ...

    def list_check_runs(self, tanka_id: str, revision_id: str) -> list[CheckRun]: ...

    def set_feedback(self, tanka_id: str, feedback: Feedback) -> None: ...

    def delete_feedback(self, tanka_id: str, fingerprint: str) -> None: ...

    def list_feedback(self, tanka_id: str) -> list[Feedback]: ...

    def increment_daily_usage(self, user_id: str, day: str, field: str = "asyncChecks") -> int:
        """その日の回数（users/{uid} の field。非同期チェックは asyncChecks、鑑賞は appreciations）を1増やし、
        増やしたあとの回数を返す。その field だけを置き換え、ほかのフィールドは残す。"""
        ...

    # --- 鑑賞 ---
    def get_appreciation(self, tanka_id: str, revision_id: str) -> Appreciation | None: ...

    def create_appreciation_if_absent(self, tanka_id: str, appreciation: Appreciation,
                                      replace_failed: bool = False) -> tuple[Appreciation, bool]:
        """その稿の鑑賞がなければ作って (作ったもの, True)。あれば (既存のもの, False)。
        replace_failed なら、失敗した鑑賞は置き換える。短歌が削除中なら NotFound。"""
        ...

    def update_appreciation_if_active(self, tanka_id: str, appreciation: Appreciation) -> bool:
        """短歌が存在し削除中でなければ書いて True（ワーカーが結果を書く）。"""
        ...

    def set_appreciation_note(self, tanka_id: str, revision_id: str, note: str | None, at: datetime) -> Appreciation:
        """作者のメモ（authorNote）だけを書き換える。鑑賞がないか短歌が削除中なら NotFound。"""
        ...

    def list_appreciations(self, tanka_id: str) -> list[Appreciation]: ...

    def mark_deleted(self, tanka_id: str, at: datetime) -> None:
        """deletedAt を立てる（一覧から即座に消え、以降の書き込みを拒否する目印）。"""
        ...

    def purge_tanka(self, tanka_id: str) -> None:
        """短歌と配下（revisions・checkRuns・feedback・appreciations）をすべて消す。何度呼んでもよい。"""
        ...

    def list_deleted_tankas(self, before: datetime) -> list[str]:
        """deletedAt が before より前のまま残っている短歌のID（消し直し用）。"""
        ...

    def delete_user_data(self, user_id: str) -> None:
        """users/{uid} を消す。"""
        ...

    # --- 連作 ---
    def create_sequence(self, seq: Sequence) -> Sequence:
        """連作を作り、中の短歌の sequenceIds に加える。削除中の短歌が含まれていれば NotFound。"""
        ...

    def update_sequence(self, seq: Sequence) -> Sequence:
        """題・並び・メモを置き換え、外れた短歌・加わった短歌の sequenceIds を直す。"""
        ...

    def delete_sequence(self, sequence_id: str) -> None:
        """連作を消し、中の短歌の sequenceIds から外す。何度呼んでもよい。"""
        ...

    def get_sequence(self, sequence_id: str) -> Sequence: ...

    def list_sequences_by_author(self, author_id: str) -> list[Sequence]:
        """updatedAt の新しい順に返す。"""
        ...

    def remove_tanka_from_sequence(self, sequence_id: str, tanka_id: str) -> None:
        """短歌の削除に伴い、連作からその歌を外す。連作がなければ何もしない。"""
        ...

    # --- 発表記録 ---
    def create_publication(self, pub: Publication) -> Publication:
        """記録を作り、中の短歌の publishedCount を増やし、出し先の候補を更新する。"""
        ...

    def update_publication(self, pub: Publication) -> Publication:
        """出し先・出した日・フリーテキストを置き換え、出し先の候補を更新する。"""
        ...

    def delete_publication(self, publication_id: str) -> None:
        """記録を消し、中の短歌の publishedCount を減らす。何度呼んでもよい。"""
        ...

    def get_publication(self, publication_id: str) -> Publication: ...

    def list_publications_by_author(self, author_id: str) -> list[Publication]:
        """出した日の新しい順に返す。"""
        ...

    def list_publications_by_tanka(self, author_id: str, tanka_id: str) -> list[Publication]:
        """その短歌を含む記録（tankaIds の array-contains）を出した日の新しい順に返す。"""
        ...

    def get_destinations(self, user_id: str) -> list[str]:
        """出し先の候補（最近使った順）。"""
        ...

    # --- 気づき ---
    def create_note(self, note: Note) -> Note: ...

    def update_note(self, note: Note) -> Note:
        """本文と updatedAt を置き換える。なければ NotFound。"""
        ...

    def delete_note(self, note_id: str) -> None:
        """気づきを消し、そこから書いた短歌の sourceNoteId を外す（短歌は残す）。何度呼んでもよい。"""
        ...

    def get_note(self, note_id: str) -> Note: ...

    def list_notes_by_author(self, author_id: str) -> list[Note]:
        """書いた日時の新しい順に返す。"""
        ...

    def count_notes_by_author(self, author_id: str) -> int: ...

    def link_tanka_to_note(self, tanka_id: str, note_id: str) -> None:
        """短歌の sourceNoteId と気づきの tankaIds を同じトランザクションで結ぶ。
        気づきがないか短歌が削除中なら NotFound。"""
        ...

    def remove_tanka_from_note(self, note_id: str, tanka_id: str) -> None:
        """短歌の削除に伴い、気づきの tankaIds からその歌を外す。気づきがなければ何もしない。"""
        ...
