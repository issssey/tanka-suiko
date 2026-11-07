"""非同期チェックの登録。

本番は Cloud Tasks → ワーカーの Cloud Run（/internal/async-check）。
配信を数秒遅らせ、連続保存されたときは最後の版だけをLLMにかける（ワーカー側で判定）。
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import UTC, datetime, timedelta
from typing import Callable, Protocol

log = logging.getLogger(__name__)


class Enqueuer(Protocol):
    def enqueue(self, payload: dict, delay_seconds: int) -> None: ...


class SyncEnqueuer:
    """その場で実行する（テスト用）。"""

    def __init__(self, handler: Callable[[dict], None] | None = None) -> None:
        self.handler = handler
        self.calls: list[dict] = []

    def enqueue(self, payload: dict, delay_seconds: int) -> None:
        self.calls.append(payload)
        if self.handler:
            self.handler(payload)


class InlineEnqueuer:
    """同じプロセスのスレッドで遅延実行する（ローカル開発用）。"""

    def __init__(self, handler: Callable[[dict], None]) -> None:
        self.handler = handler

    def enqueue(self, payload: dict, delay_seconds: int) -> None:
        def run() -> None:
            try:
                self.handler(payload)
            except Exception:  # pragma: no cover
                log.exception("async check failed")

        timer = threading.Timer(max(delay_seconds, 0), run)
        timer.daemon = True
        timer.start()


class CloudTasksEnqueuer:
    def __init__(self, queue: str, worker_url: str, service_account: str, audience: str | None = None) -> None:
        from google.cloud import tasks_v2

        self._tasks_v2 = tasks_v2
        self.client = tasks_v2.CloudTasksClient()
        self.queue = queue
        self.worker_url = worker_url
        self.service_account = service_account
        self.audience = audience or worker_url

    def enqueue(self, payload: dict, delay_seconds: int) -> None:
        from google.protobuf import timestamp_pb2

        tasks_v2 = self._tasks_v2
        schedule = timestamp_pb2.Timestamp()
        schedule.FromDatetime(datetime.now(UTC) + timedelta(seconds=delay_seconds))
        task = tasks_v2.Task(
            http_request=tasks_v2.HttpRequest(
                http_method=tasks_v2.HttpMethod.POST,
                url=self.worker_url,
                headers={"Content-Type": "application/json"},
                body=json.dumps(payload).encode(),
                oidc_token=tasks_v2.OidcToken(
                    service_account_email=self.service_account, audience=self.audience
                ),
            ),
            schedule_time=schedule,
        )
        self.client.create_task(parent=self.queue, task=task)
