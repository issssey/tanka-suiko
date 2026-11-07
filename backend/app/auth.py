"""認証。

- クライアント→API：Firebase Authentication の IDトークンを検証する
- Cloud Tasks→ワーカー：OIDCトークンを検証し、発行元のサービスアカウントを確かめる
- AUTH_MODE=dev のときは "Bearer dev:<uid>" を受け付ける（ローカル開発・テスト用）
"""

from __future__ import annotations

import os
from functools import lru_cache

from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings


@lru_cache(maxsize=1)
def _google_request():
    from google.auth.transport import requests as g_requests

    return g_requests.Request()


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "認証が必要です")
    return authorization.split(" ", 1)[1].strip()


def _verify_firebase(token: str, settings: Settings) -> str:
    if os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
        # エミュレータのトークンは署名がないので、中身だけ読む
        from google.auth import jwt

        claims = jwt.decode(token, verify=False)
    else:
        from google.oauth2 import id_token

        try:
            claims = id_token.verify_firebase_token(token, _google_request(), audience=settings.firebase_project_id)
        except ValueError as e:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "トークンが無効です") from e
    uid = claims.get("user_id") or claims.get("sub") if claims else None
    if not uid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "トークンが無効です")
    return uid


def current_user(authorization: str | None = Header(default=None), settings: Settings = Depends(get_settings)) -> str:
    token = _bearer(authorization)
    if settings.auth_mode == "dev" and token.startswith("dev:"):
        return token[4:] or "dev-user"
    if settings.auth_mode == "dev" and not os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "dev モードでは 'dev:<uid>' を使ってください")
    return _verify_firebase(token, settings)


def verify_tasks_caller(authorization: str | None = Header(default=None), settings: Settings = Depends(get_settings)) -> None:
    if settings.auth_mode == "dev":
        return
    token = _bearer(authorization)
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(token, _google_request(), audience=settings.worker_audience or settings.worker_url)
    except ValueError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "トークンが無効です") from e
    if settings.tasks_service_account and claims.get("email") != settings.tasks_service_account:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "呼び出し元が許可されていません")
