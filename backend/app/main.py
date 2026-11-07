"""FastAPI アプリ。APP_ROLE=api / worker / all で公開するルートを切り替える。

書き込みと処理はすべてこのAPIを通し、読み取りはクライアントが Firestore SDK で直接行う。
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .auth import current_user, delete_firebase_user, verify_tasks_caller
from .checkers.llm import AnthropicJSONClient, LLMChecker, NullLLMClient
from .config import Settings, get_settings
from .patterns import load_patterns
from .preprocess.pipeline import ConfirmedSegment, PreprocessError
from .repository.base import NotFound
from .service import BadRequest, Forbidden, Service
from .tasks import CloudTasksEnqueuer, InlineEnqueuer, SyncEnqueuer

logging.basicConfig(level=logging.INFO)


# --- 入出力 ---------------------------------------------------------------


class PreprocessIn(BaseModel):
    body: str = Field(min_length=1, max_length=200)
    style: Literal["colloquial", "literary"] | None = None
    orthography: Literal["modern", "historical"] | None = None
    readingOverrides: dict[str, str] = Field(default_factory=dict)


class SegmentIn(BaseModel):
    no: int
    text: str
    reading: str


class CreateRevisionIn(BaseModel):
    parentRevisionId: str | None = None
    body: str = Field(min_length=1, max_length=200)
    segments: list[SegmentIn]
    style: Literal["colloquial", "literary"]
    orthography: Literal["modern", "historical"]
    note: str | None = Field(default=None, max_length=500)
    readingChoices: dict[str, str] = Field(default_factory=dict)


class FeedbackIn(BaseModel):
    status: Literal["intentional", "false_positive"]
    comment: str | None = Field(default=None, max_length=500)
    revisionId: str | None = None  # どの稿のチェック結果で設定したか


class AsyncCheckIn(BaseModel):
    tankaId: str
    revisionId: str
    runId: str


class PurgeIn(BaseModel):
    tankaId: str


# --- 組み立て ---------------------------------------------------------------


def build_service(settings: Settings) -> Service:
    patterns = load_patterns()
    if settings.repository == "firestore":
        from .repository.firestore import FirestoreRepository

        repo = FirestoreRepository()
    else:
        from .repository.memory import MemoryRepository

        repo = MemoryRepository()

    if settings.llm_provider in ("anthropic", "vertex"):
        client = AnthropicJSONClient(
            model=settings.llm_model,
            provider=settings.llm_provider,
            effort=settings.llm_effort,
            vertex_project=settings.vertex_project,
            vertex_region=settings.vertex_region,
        )
    else:
        client = NullLLMClient()

    service = Service(repo, SyncEnqueuer(), LLMChecker(client), settings, patterns)

    def handle(payload: dict) -> None:
        if payload.get("kind") == "purge":
            service.purge_tanka(payload["tankaId"])
        else:
            service.run_async_check(payload["tankaId"], payload["revisionId"], payload["runId"])

    if settings.tasks_mode == "cloudtasks":
        if not (settings.tasks_queue and settings.worker_url and settings.tasks_service_account):
            raise RuntimeError("CLOUD_TASKS_QUEUE / WORKER_URL / TASKS_SERVICE_ACCOUNT を設定してください")
        service.enqueuer = CloudTasksEnqueuer(
            settings.tasks_queue, settings.worker_url, settings.tasks_service_account, settings.worker_audience
        )
    elif settings.tasks_mode == "sync":
        service.enqueuer = SyncEnqueuer(handle)
    else:
        service.enqueuer = InlineEnqueuer(handle)
    return service


def create_app(settings: Settings | None = None, service: Service | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="短歌アンチパターン検出API", version="0.1.0")
    app.state.service = service or build_service(settings)
    app.state.settings = settings
    app.dependency_overrides[get_settings] = lambda: settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(NotFound)
    async def _not_found(request: Request, exc: NotFound):
        return JSONResponse({"detail": "見つかりません"}, status_code=404)

    @app.exception_handler(Forbidden)
    async def _forbidden(request: Request, exc: Forbidden):
        return JSONResponse({"detail": "権限がありません"}, status_code=403)

    @app.exception_handler(BadRequest)
    async def _bad_request(request: Request, exc: BadRequest):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(PreprocessError)
    async def _preprocess_error(request: Request, exc: PreprocessError):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "role": settings.app_role}

    if settings.app_role in ("api", "all"):
        app.include_router(api_router())
    if settings.app_role in ("worker", "all"):
        app.include_router(worker_router())
    return app


def svc(request: Request) -> Service:
    return request.app.state.service


def api_router() -> APIRouter:
    r = APIRouter()

    @r.post("/tankas", status_code=status.HTTP_201_CREATED)
    def create_tanka(user: str = Depends(current_user), s: Service = Depends(svc)):
        t = s.create_tanka(user)
        return {"tankaId": t.id}

    @r.delete("/tankas/{tanka_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_tanka(tanka_id: str, user: str = Depends(current_user), s: Service = Depends(svc)):
        s.delete_tanka(user, tanka_id)

    @r.post("/tankas/{tanka_id}/preprocess")
    def preprocess(tanka_id: str, body: PreprocessIn, user: str = Depends(current_user), s: Service = Depends(svc)):
        res = s.preprocess(user, tanka_id, body.body, style=body.style, orthography=body.orthography,
                           reading_overrides=body.readingOverrides)
        return {
            "bodyNormalized": res.bodyNormalized,
            "hints": res.hints,
            "style": res.style,
            "orthography": res.orthography,
            "detectedStyle": res.detectedStyle,
            "detectedOrthography": res.detectedOrthography,
            "segments": [seg.model_dump() for seg in res.segments],
            "tokens": [t.model_dump() for t in res.tokens],
            "candidates": [asdict(c) for c in res.candidates],
            "unknownWords": [asdict(u) for u in res.unknownWords],
            "totalMora": res.totalMora,
        }

    @r.post("/tankas/{tanka_id}/revisions", status_code=status.HTTP_201_CREATED)
    def create_revision(tanka_id: str, body: CreateRevisionIn, user: str = Depends(current_user), s: Service = Depends(svc)):
        res = s.create_revision(
            user, tanka_id,
            parent_revision_id=body.parentRevisionId,
            body=body.body,
            segments=[ConfirmedSegment(x.no, x.text, x.reading) for x in body.segments],
            style=body.style,
            orthography=body.orthography,
            note=body.note,
            reading_choices=body.readingChoices,
        )
        return _save_response(res)

    @r.post("/tankas/{tanka_id}/revisions/{revision_id}/recheck", status_code=status.HTTP_201_CREATED)
    def recheck(tanka_id: str, revision_id: str, user: str = Depends(current_user), s: Service = Depends(svc)):
        return _save_response(s.recheck(user, tanka_id, revision_id))

    @r.put("/tankas/{tanka_id}/feedback/{fingerprint}")
    def put_feedback(tanka_id: str, fingerprint: str, body: FeedbackIn, user: str = Depends(current_user), s: Service = Depends(svc)):
        fb = s.set_feedback(user, tanka_id, fingerprint, body.status, body.comment, body.revisionId)
        return fb.model_dump(mode="json")

    @r.delete("/tankas/{tanka_id}/feedback/{fingerprint}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_feedback(tanka_id: str, fingerprint: str, user: str = Depends(current_user), s: Service = Depends(svc)):
        s.delete_feedback(user, tanka_id, fingerprint)

    @r.get("/me/export")
    def export_me(user: str = Depends(current_user), s: Service = Depends(svc)):
        return JSONResponse(
            s.export_user(user),
            headers={"Content-Disposition": 'attachment; filename="suikocho-export.json"'},
        )

    @r.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
    def delete_me(request: Request, user: str = Depends(current_user), s: Service = Depends(svc)):
        settings: Settings = request.app.state.settings
        s.delete_account(user, lambda uid: delete_firebase_user(uid, settings))

    return r


def _save_response(res) -> dict:
    return {
        "revisionId": res.revision.id,
        "revisionNo": res.revision.revisionNo,
        "syncRun": {
            "runId": res.sync_run.id,
            "findings": [f.model_dump(mode="json") for f in res.sync_run.findings],
            "resolvedFingerprints": res.sync_run.resolvedFingerprints,
        },
        "asyncRunId": res.async_run.id,
        "asyncRunStatus": res.async_run.status,
    }


def worker_router() -> APIRouter:
    r = APIRouter()

    @r.post("/internal/async-check", dependencies=[Depends(verify_tasks_caller)])
    def async_check(body: AsyncCheckIn, s: Service = Depends(svc)):
        try:
            run = s.run_async_check(body.tankaId, body.revisionId, body.runId)
        except NotFound:
            # 再試行しても直らないので 200 を返して Cloud Tasks の再配信を止める
            return {"status": "not_found"}
        return {"status": run.status}

    @r.post("/internal/purge-tanka", dependencies=[Depends(verify_tasks_caller)])
    def purge(body: PurgeIn, s: Service = Depends(svc)):
        # 失敗したら例外で 500 を返し、Cloud Tasks に再試行させる
        s.purge_tanka(body.tankaId)
        return {"status": "ok"}

    @r.post("/internal/cleanup-deleted", dependencies=[Depends(verify_tasks_caller)])
    def cleanup(s: Service = Depends(svc)):
        """deletedAt が立ったまま残っている短歌を消し直す（Cloud Scheduler から定期的に呼ぶ）。"""
        return {"purged": s.cleanup_deleted()}

    return r


def get_app() -> FastAPI:  # uvicorn app.main:get_app --factory
    return create_app()
