"""ユースケース。APIとワーカーはこの層を呼ぶ。"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from .checkers.base import CheckContext
from .checkers.llm import LLMChecker, LLMError, prompt_version
from .checkers.runner import apply_transitions, run_async, run_sync
from .config import Settings
from .models import CheckRun, Feedback, Finding, Revision, Tanka
from .patterns import PatternSet
from .preprocess.pipeline import ConfirmedSegment, PreprocessResult, build_from_confirmed, preprocess
from .repository.base import NotFound, Repository
from .tasks import Enqueuer

log = logging.getLogger(__name__)


class Forbidden(PermissionError):
    pass


class BadRequest(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _latest(runs: list[CheckRun], phase: str) -> CheckRun | None:
    done = [r for r in runs if r.phase == phase and r.status == "done"]
    return done[-1] if done else None


def content_hash(rev: Revision) -> str:
    return hashlib.sha256(f"{rev.bodyNormalized}\n{rev.reading}\n{rev.style}\n{rev.orthography}".encode()).hexdigest()


@dataclass
class SaveResult:
    revision: Revision
    sync_run: CheckRun
    async_run: CheckRun


class Service:
    def __init__(self, repo: Repository, enqueuer: Enqueuer, llm: LLMChecker, settings: Settings, patterns: PatternSet) -> None:
        self.repo = repo
        self.enqueuer = enqueuer
        self.llm = llm
        self.settings = settings
        self.patterns = patterns

    # --- 認可 ---
    def _own_tanka(self, user_id: str, tanka_id: str) -> Tanka:
        try:
            tanka = self.repo.get_tanka(tanka_id)
        except NotFound:
            raise
        if tanka.authorId != user_id:
            raise Forbidden(tanka_id)
        return tanka

    # --- 短歌 ---
    def create_tanka(self, user_id: str, title: str | None) -> Tanka:
        title = (title or "").strip() or None
        return self.repo.create_tanka(user_id, title)

    def preprocess(self, user_id: str, tanka_id: str, body: str, *, style: str | None, orthography: str | None,
                   reading_overrides: dict[str, str] | None) -> PreprocessResult:
        tanka = self._own_tanka(user_id, tanka_id)
        return preprocess(body, style=style, orthography=orthography,
                          reading_memory=tanka.readingMemory, reading_overrides=reading_overrides)

    # --- 推敲版の保存 ---
    def create_revision(self, user_id: str, tanka_id: str, *, parent_revision_id: str | None, body: str,
                        segments: list[ConfirmedSegment], style: str, orthography: str, note: str | None,
                        reading_choices: dict[str, str] | None = None) -> SaveResult:
        tanka = self._own_tanka(user_id, tanka_id)
        if parent_revision_id is None:
            parent_revision_id = tanka.currentRevisionId
        if parent_revision_id is not None:
            try:
                self.repo.get_revision(tanka_id, parent_revision_id)
            except NotFound as e:
                raise BadRequest("親の版が見つかりません") from e
        memory = {**tanka.readingMemory, **(reading_choices or {})}
        try:
            built = build_from_confirmed(body, segments, style=style, reading_memory=memory)
        except ValueError as e:
            raise BadRequest(str(e)) from e

        revision = self.repo.create_revision(
            tanka_id,
            {
                "parentRevisionId": parent_revision_id,
                "body": built.body,
                "bodyNormalized": built.bodyNormalized,
                "reading": built.reading,
                "orthography": orthography,
                "style": style,
                "segments": built.segments,
                "tokens": built.tokens,
                "note": (note or "").strip() or None,
            },
            reading_choices or {},
        )
        sync_run = self._run_sync(tanka_id, revision)
        async_run = self._queue_async(tanka_id, revision, trigger="save")
        return SaveResult(revision, sync_run, async_run)

    def recheck(self, user_id: str, tanka_id: str, revision_id: str) -> SaveResult:
        """ルールやプロンプトの更新後の再チェック。新しい checkRuns を追加する。"""
        self._own_tanka(user_id, tanka_id)
        revision = self.repo.get_revision(tanka_id, revision_id)
        sync_run = self._run_sync(tanka_id, revision)
        async_run = self._queue_async(tanka_id, revision, trigger="recheck")
        return SaveResult(revision, sync_run, async_run)

    # --- コンテキスト ---
    def _context(self, tanka_id: str, revision: Revision) -> tuple[CheckContext, list[CheckRun]]:
        history = [r for r in self.repo.list_revisions(tanka_id) if r.revisionNo < revision.revisionNo]
        by_id = {r.id: r for r in history}
        parent = by_id.get(revision.parentRevisionId) if revision.parentRevisionId else None
        parent_runs = self.repo.list_check_runs(tanka_id, parent.id) if parent else []
        parent_sync = _latest(parent_runs, "sync")
        parent_async = _latest(parent_runs, "async")
        ctx = CheckContext(
            revision=revision,
            patterns=self.patterns,
            parent=parent,
            first=history[0] if history else revision,
            history=history,
            previous_findings=[*(parent_sync.findings if parent_sync else []), *(parent_async.findings if parent_async else [])],
            parent_rule_results=parent_sync.findings if parent_sync else [],
            feedback={f.fingerprint: f for f in self.repo.list_feedback(tanka_id)},
        )
        return ctx, parent_runs

    def _previous_async(self, tanka_id: str, ctx: CheckContext) -> list[Finding] | None:
        """非同期の比較相手。親の非同期が終わっていない（飛ばされた）場合は、さらに前の版をたどる。"""
        by_id = {r.id: r for r in ctx.history}
        current = ctx.parent
        while current is not None:
            run = _latest(self.repo.list_check_runs(tanka_id, current.id), "async")
            if run is not None:
                return run.findings
            current = by_id.get(current.parentRevisionId) if current.parentRevisionId else None
        return None if ctx.parent is None else []

    # --- 同期チェック ---
    def _run_sync(self, tanka_id: str, revision: Revision) -> CheckRun:
        ctx, parent_runs = self._context(tanka_id, revision)
        parent_sync = _latest(parent_runs, "sync")
        started = _now()
        findings, resolved = run_sync(ctx, parent_sync.findings if parent_sync else None)
        run = CheckRun(
            id="",
            phase="sync",
            baseRevisionId=revision.parentRevisionId,
            rulesetVersion=self.patterns.version,
            status="done",
            findings=findings,
            resolvedFingerprints=resolved,
            startedAt=started,
            finishedAt=_now(),
        )
        return self.repo.add_check_run(tanka_id, revision.id, run)

    # --- 非同期チェック ---
    def _queue_async(self, tanka_id: str, revision: Revision, trigger: str) -> CheckRun:
        run = CheckRun(
            id="",
            phase="async",
            baseRevisionId=revision.parentRevisionId,
            rulesetVersion=self.patterns.version,
            llmModel=self.llm.client.model,
            promptVersion=prompt_version(self.patterns.version),
            status="queued",
            trigger=trigger,
            startedAt=_now(),
        )
        run = self.repo.add_check_run(tanka_id, revision.id, run)
        self.enqueuer.enqueue(
            {"tankaId": tanka_id, "revisionId": revision.id, "runId": run.id},
            self.settings.async_delay_seconds if trigger == "save" else 0,
        )
        return run

    def run_async_check(self, tanka_id: str, revision_id: str, run_id: str) -> CheckRun:
        runs = self.repo.list_check_runs(tanka_id, revision_id)
        run = next((r for r in runs if r.id == run_id), None)
        if run is None:
            raise NotFound(run_id)
        if run.status not in ("queued", "running"):
            return run  # Cloud Tasks の再配信。すでに処理済み
        tanka = self.repo.get_tanka(tanka_id)
        revision = self.repo.get_revision(tanka_id, revision_id)

        def finish(status: str, **fields) -> CheckRun:
            done = run.model_copy(update={"status": status, "finishedAt": _now(), **fields})
            self.repo.update_check_run(tanka_id, revision_id, done)
            return done

        # 連続保存：最新の版でなければLLMにかけない
        if run.trigger == "save" and tanka.currentRevisionId != revision_id:
            return finish("skipped")

        ctx, _ = self._context(tanka_id, revision)
        ctx.rule_results = (_latest(runs, "sync").findings if _latest(runs, "sync") else [])
        previous = self._previous_async(tanka_id, ctx)

        # 本文と読みが親の版と同じなら、LLMを呼ばずに結果を再利用する
        if ctx.parent is not None and content_hash(ctx.parent) == content_hash(revision):
            parent_async = _latest(self.repo.list_check_runs(tanka_id, ctx.parent.id), "async")
            if parent_async is not None:
                findings = [f.model_copy(deep=True) for f in parent_async.findings]
                resolved = apply_transitions(findings, parent_async.findings)
                return finish("done", findings=findings, resolvedFingerprints=resolved,
                              reusedFromRunId=parent_async.id)

        day = datetime.now(ZoneInfo(self.settings.timezone)).strftime("%Y-%m-%d")
        if self.repo.increment_daily_usage(tanka.authorId, day) > self.settings.async_daily_limit:
            return finish("limited")

        running = run.model_copy(update={"status": "running"})
        self.repo.update_check_run(tanka_id, revision_id, running)
        try:
            outcome = run_async(ctx, self.llm, previous)
        except LLMError as e:
            log.warning("LLM check failed: %s", e)
            return finish("failed", error=str(e))
        return finish("done", findings=outcome.findings, resolvedFingerprints=outcome.resolved)

    # --- 作者の判断 ---
    def set_feedback(self, user_id: str, tanka_id: str, fingerprint: str, status: str, comment: str | None) -> Feedback:
        self._own_tanka(user_id, tanka_id)
        fb = Feedback(fingerprint=fingerprint, status=status, comment=(comment or "").strip() or None, createdAt=_now())
        self.repo.set_feedback(tanka_id, fb)
        return fb

    def delete_feedback(self, user_id: str, tanka_id: str, fingerprint: str) -> None:
        self._own_tanka(user_id, tanka_id)
        self.repo.delete_feedback(tanka_id, fingerprint)
