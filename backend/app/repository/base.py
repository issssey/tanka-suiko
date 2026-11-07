"""永続化のインターフェース。本番は Firestore、テストとローカル開発はメモリを使う。

パス（Firestore）:
  users/{uid}                                   … 1日の非同期チェック回数（usage）
  tankas/{tankaId}
    revisions/{revisionId}                      … 保存後は変更しない
      checkRuns/{runId}                         … findings を配列で持つ
    feedback/{fingerprint}                      … 作者の判断（短歌単位）
"""

from __future__ import annotations

from typing import Any, Protocol

from ..models import CheckRun, Feedback, Revision, Tanka


class NotFound(LookupError):
    pass


class Repository(Protocol):
    def create_tanka(self, author_id: str, title: str | None) -> Tanka: ...

    def get_tanka(self, tanka_id: str) -> Tanka: ...

    def create_revision(self, tanka_id: str, data: dict[str, Any], reading_memory: dict[str, str]) -> Revision:
        """revisionNo をトランザクションで採番して推敲版を保存し、短歌の currentRevisionId を進める。"""
        ...

    def get_revision(self, tanka_id: str, revision_id: str) -> Revision: ...

    def list_revisions(self, tanka_id: str) -> list[Revision]: ...

    def add_check_run(self, tanka_id: str, revision_id: str, run: CheckRun) -> CheckRun: ...

    def update_check_run(self, tanka_id: str, revision_id: str, run: CheckRun) -> None: ...

    def list_check_runs(self, tanka_id: str, revision_id: str) -> list[CheckRun]: ...

    def set_feedback(self, tanka_id: str, feedback: Feedback) -> None: ...

    def delete_feedback(self, tanka_id: str, fingerprint: str) -> None: ...

    def list_feedback(self, tanka_id: str) -> list[Feedback]: ...

    def increment_daily_usage(self, user_id: str, day: str) -> int:
        """その日の非同期チェック回数を1増やし、増やしたあとの回数を返す。"""
        ...
