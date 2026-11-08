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
from pydantic import BaseModel, Field, field_validator

from .auth import current_user, delete_firebase_user, verify_tasks_caller
from .checkers.llm import AnthropicJSONClient, LLMChecker, NullLLMClient
from .config import Settings, check_production_safety, get_settings
from .patterns import load_patterns
from .preprocess.pipeline import ConfirmedSegment, PreprocessError
from .repository.base import NotFound
from .service import BadRequest, Forbidden, Service
from .tasks import CloudTasksEnqueuer, InlineEnqueuer, SyncEnqueuer

logging.basicConfig(level=logging.INFO)


# --- 入出力 ---------------------------------------------------------------


# 入力の上限。LLMへの入力（＝費用）が際限なく大きくならないよう、API で必ず確かめる。
# 短歌は31音前後なので、本文は空白込みで80字あれば足りる。
MAX_BODY = 80
MAX_SEGMENT_TEXT = 40
MAX_READING = 40  # 1句の読み（かな）
MAX_CHOICES = 20  # 読みの選択（表層形 → 読み）の数
MAX_CHOICE_SURFACE = 20
MAX_CHOICE_READING = 20


def _is_reading(text: str) -> bool:
    """読みとして受け付ける文字（ひらがな・カタカナ・長音・空白）だけか。"""
    return all(0x3041 <= ord(c) <= 0x30FF or c in " 　" for c in text)


def _check_choices(value: dict[str, str]) -> dict[str, str]:
    if len(value) > MAX_CHOICES:
        raise ValueError(f"読みの選択は{MAX_CHOICES}件までです")
    for surface, reading in value.items():
        if not surface or len(surface) > MAX_CHOICE_SURFACE:
            raise ValueError("読みを選んだ語が長すぎます")
        if not reading or len(reading) > MAX_CHOICE_READING or not _is_reading(reading):
            raise ValueError("読みは20字までのかなで入力してください")
    return value


class PreprocessIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_BODY)
    style: Literal["colloquial", "literary"] | None = None
    orthography: Literal["modern", "historical"] | None = None
    readingOverrides: dict[str, str] = Field(default_factory=dict)

    _overrides = field_validator("readingOverrides")(_check_choices)


class SegmentIn(BaseModel):
    no: int = Field(ge=1, le=5)
    text: str = Field(min_length=1, max_length=MAX_SEGMENT_TEXT)
    reading: str = Field(min_length=1, max_length=MAX_READING)

    @field_validator("reading")
    @classmethod
    def _kana_only(cls, v: str) -> str:
        if not _is_reading(v):
            raise ValueError("読みはかなで入力してください")
        return v


class CreateRevisionIn(BaseModel):
    parentRevisionId: str | None = None
    body: str = Field(min_length=1, max_length=MAX_BODY)
    segments: list[SegmentIn] = Field(min_length=5, max_length=5)
    style: Literal["colloquial", "literary"]
    orthography: Literal["modern", "historical"]
    note: str | None = Field(default=None, max_length=200)
    readingChoices: dict[str, str] = Field(default_factory=dict)

    _choices = field_validator("readingChoices")(_check_choices)


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


# --- 連作と発表 ---
MAX_TITLE = 100
MAX_DESTINATION = 100
MAX_NOTE = 500
MAX_ITEMS = 100


class SequenceItemIn(BaseModel):
    tankaId: str = Field(min_length=1, max_length=100)
    revisionId: str | None = Field(default=None, max_length=100)  # 省略したらいまの稿


class SequenceIn(BaseModel):
    title: str = Field(default="", max_length=MAX_TITLE)
    items: list[SequenceItemIn] = Field(default_factory=list, max_length=MAX_ITEMS)
    note: str | None = Field(default=None, max_length=MAX_NOTE)


class PublicationItemIn(BaseModel):
    tankaId: str = Field(min_length=1, max_length=100)
    revisionId: str = Field(min_length=1, max_length=100)


class PublicationFieldsIn(BaseModel):
    destination: str = Field(min_length=1, max_length=MAX_DESTINATION)
    submittedOn: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str | None = Field(default=None, max_length=MAX_NOTE)

    @field_validator("destination")
    @classmethod
    def _destination(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("出し先を入力してください")
        return v

    @field_validator("submittedOn")
    @classmethod
    def _date(cls, v: str) -> str:
        from datetime import date

        date.fromisoformat(v)  # 存在しない日付は ValueError
        return v


class PublicationIn(PublicationFieldsIn):
    """稿のリストか sequenceId のどちらかを受け取る。"""

    items: list[PublicationItemIn] | None = Field(default=None, max_length=MAX_ITEMS)
    sequenceId: str | None = Field(default=None, max_length=100)


class PublicationCheckIn(BaseModel):
    tankaIds: list[str] = Field(min_length=1, max_length=MAX_ITEMS)


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
    if service is None:
        check_production_safety(settings)
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

    # Cloud Run は z で終わるパス（/healthz など）を予約していて、アプリに届かない。
    # 本番の疎通確認には /health を使う（/healthz はローカル用に残す）
    @app.get("/health")
    @app.get("/healthz")
    def health():
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

    @r.post("/tankas/{tanka_id}/revisions/{revision_id}/restore", status_code=status.HTTP_201_CREATED)
    def restore(tanka_id: str, revision_id: str, user: str = Depends(current_user), s: Service = Depends(svc)):
        return _save_response(s.restore_revision(user, tanka_id, revision_id))

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

    # --- 連作 ---
    @r.post("/sequences", status_code=status.HTTP_201_CREATED)
    def create_sequence(body: SequenceIn, user: str = Depends(current_user), s: Service = Depends(svc)):
        seq = s.create_sequence(user, body.title, [(i.tankaId, i.revisionId) for i in body.items], body.note)
        return seq.model_dump(mode="json")

    @r.put("/sequences/{sequence_id}")
    def update_sequence(sequence_id: str, body: SequenceIn, user: str = Depends(current_user), s: Service = Depends(svc)):
        seq = s.update_sequence(user, sequence_id, body.title, [(i.tankaId, i.revisionId) for i in body.items], body.note)
        return seq.model_dump(mode="json")

    @r.delete("/sequences/{sequence_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_sequence(sequence_id: str, user: str = Depends(current_user), s: Service = Depends(svc)):
        s.delete_sequence(user, sequence_id)

    # --- 発表記録 ---
    @r.post("/publications/check")
    def check_publications(body: PublicationCheckIn, user: str = Depends(current_user), s: Service = Depends(svc)):
        return {"publications": [p.model_dump(mode="json") for p in s.check_publications(user, body.tankaIds)]}

    @r.post("/publications", status_code=status.HTTP_201_CREATED)
    def create_publication(body: PublicationIn, user: str = Depends(current_user), s: Service = Depends(svc)):
        if (body.items is None) == (body.sequenceId is None):
            raise HTTPException(422, "稿のリストか連作のどちらかを指定してください")
        pub = s.create_publication(
            user, destination=body.destination, submitted_on=body.submittedOn, note=body.note,
            items=[(i.tankaId, i.revisionId) for i in body.items] if body.items is not None else None,
            sequence_id=body.sequenceId,
        )
        return pub.model_dump(mode="json")

    @r.put("/publications/{publication_id}")
    def update_publication(publication_id: str, body: PublicationFieldsIn, user: str = Depends(current_user),
                           s: Service = Depends(svc)):
        pub = s.update_publication(user, publication_id, destination=body.destination,
                                   submitted_on=body.submittedOn, note=body.note)
        return pub.model_dump(mode="json")

    @r.delete("/publications/{publication_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_publication(publication_id: str, user: str = Depends(current_user), s: Service = Depends(svc)):
        s.delete_publication(user, publication_id)

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
