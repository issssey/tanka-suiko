"""永続化のインターフェース。本番は Firestore、テストとローカル開発はメモリを使う。

パス（Firestore）:
  users/{uid}                                   … 1日の非同期チェック回数（usage）
  tankas/{tankaId}                              … 題は持たない。latestBody で一覧を描く
    revisions/{revisionId}                      … 保存後は変更しない
      checkRuns/{runId}                         … findings を配列で持つ
    feedback/{fingerprint}                      … 作者の判断（短歌単位）

削除は短歌単位のみ。deletedAt を立ててから配下をまとめて消す。
削除中・削除済みの短歌には書き込まない（*_if_active はトランザクションで確かめてから書く）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from ..models import CheckRun, Feedback, Revision, Tanka


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

    def increment_daily_usage(self, user_id: str, day: str) -> int:
        """その日の非同期チェック回数を1増やし、増やしたあとの回数を返す。"""
        ...

    def mark_deleted(self, tanka_id: str, at: datetime) -> None:
        """deletedAt を立てる（一覧から即座に消え、以降の書き込みを拒否する目印）。"""
        ...

    def purge_tanka(self, tanka_id: str) -> None:
        """短歌と配下（revisions・checkRuns・feedback）をすべて消す。何度呼んでもよい。"""
        ...

    def list_deleted_tankas(self, before: datetime) -> list[str]:
        """deletedAt が before より前のまま残っている短歌のID（消し直し用）。"""
        ...

    def delete_user_data(self, user_id: str) -> None:
        """users/{uid} を消す。"""
        ...
