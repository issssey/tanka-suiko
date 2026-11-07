"""設定（環境変数から読む）。"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    # api / worker / all（1つのイメージをAPIとワーカーの2サービスで使う）
    app_role: str = "all"
    # firestore / memory
    repository: str = "memory"
    # firebase / dev（dev は "Bearer dev:<uid>" を受け付ける。本番では使わない）
    auth_mode: str = "dev"
    firebase_project_id: str | None = None
    # cloudtasks / inline / sync（sync はテスト用。その場で実行する）
    tasks_mode: str = "inline"
    tasks_queue: str | None = None  # projects/<p>/locations/<l>/queues/<q>
    worker_url: str | None = None  # ワーカーのサービスのURL（https://<worker>）
    tasks_service_account: str | None = None
    worker_audience: str | None = None
    # 連続保存のとき、最後の版だけLLMにかけるための遅延（秒）
    async_delay_seconds: int = 5
    async_daily_limit: int = 100
    # LLM: anthropic / vertex / none
    llm_provider: str = "none"
    llm_model: str = "claude-haiku-5-5"
    llm_effort: str | None = None
    vertex_project: str | None = None
    vertex_region: str = "global"
    # 画面に出す confidence の下限（保存はすべて行う）
    display_confidence_threshold: float = 0.5
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:5173"])
    timezone: str = "Asia/Tokyo"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        app_role=_env("APP_ROLE", "all"),
        repository=_env("REPOSITORY", "memory"),
        auth_mode=_env("AUTH_MODE", "dev"),
        firebase_project_id=_env("FIREBASE_PROJECT_ID") or _env("GOOGLE_CLOUD_PROJECT"),
        tasks_mode=_env("TASKS_MODE", "inline"),
        tasks_queue=_env("CLOUD_TASKS_QUEUE"),
        worker_url=_env("WORKER_URL"),
        tasks_service_account=_env("TASKS_SERVICE_ACCOUNT"),
        worker_audience=_env("WORKER_AUDIENCE"),
        async_delay_seconds=int(_env("ASYNC_DELAY_SECONDS", "5")),
        async_daily_limit=int(_env("ASYNC_DAILY_LIMIT", "100")),
        llm_provider=_env("LLM_PROVIDER", "none"),
        llm_model=_env("LLM_MODEL", "claude-haiku-5-5"),
        llm_effort=_env("LLM_EFFORT"),
        vertex_project=_env("VERTEX_PROJECT") or _env("GOOGLE_CLOUD_PROJECT"),
        vertex_region=_env("VERTEX_REGION", "global"),
        display_confidence_threshold=float(_env("DISPLAY_CONFIDENCE_THRESHOLD", "0.5")),
        cors_origins=[o.strip() for o in (_env("CORS_ORIGINS", "http://localhost:5173") or "").split(",") if o.strip()],
        timezone=_env("TIMEZONE", "Asia/Tokyo"),
    )
