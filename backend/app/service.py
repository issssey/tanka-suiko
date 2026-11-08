"""ユースケース。APIとワーカーはこの層を呼ぶ。"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Callable
from zoneinfo import ZoneInfo

from .checkers.base import CheckContext
from .checkers.llm import LLMChecker, LLMError, prompt_version
from .checkers.runner import apply_transitions, current_fingerprint, run_async, run_sync
from .config import Settings
from .models import (
    MAX_SEQUENCE_ITEMS,
    CheckRun,
    Feedback,
    Finding,
    Publication,
    PublicationItem,
    Revision,
    Sequence,
    SequenceItem,
    Tanka,
)
from .patterns import PatternSet
from .preprocess.pipeline import ConfirmedSegment, PreprocessResult, build_from_confirmed, preprocess
from .repository.base import NotFound, Repository
from .tasks import Enqueuer

log = logging.getLogger(__name__)


# サービス全体の回数を数えるキー（users/{id} に置く）。
# Firebase の uid（英数字）と重ならず、Firestore の予約ID（__ で始まり __ で終わる）でもない名前にする
GLOBAL_USAGE_KEY = "service-total"


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
        """自分の短歌を返す。削除中の短歌は存在しないものとして扱う。"""
        tanka = self.repo.get_tanka(tanka_id)
        if tanka.deletedAt is not None:
            raise NotFound(tanka_id)
        if tanka.authorId != user_id:
            raise Forbidden(tanka_id)
        return tanka

    # --- 短歌 ---
    def create_tanka(self, user_id: str) -> Tanka:
        """短歌を新規作成する。題は持たない。"""
        return self.repo.create_tanka(user_id)

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

    def restore_revision(self, user_id: str, tanka_id: str, revision_id: str) -> SaveResult:
        """「この稿に戻す」。昔の稿と同じ内容の稿を、その稿を親にして新しく保存し、いまの稿にする。
        本文と読みが親と同じなので、意味のチェックは親の結果を再利用する（LLMを呼ばない）。"""
        tanka = self._own_tanka(user_id, tanka_id)
        try:
            source = self.repo.get_revision(tanka_id, revision_id)
        except NotFound as e:
            raise BadRequest("戻す稿が見つかりません") from e
        if tanka.currentRevisionId == source.id:
            raise BadRequest("この稿はすでにいまの稿です")
        revision = self.repo.create_revision(
            tanka_id,
            {
                "parentRevisionId": source.id,
                "body": source.body,
                "bodyNormalized": source.bodyNormalized,
                "reading": source.reading,
                "orthography": source.orthography,
                "style": source.style,
                "segments": source.segments,
                "tokens": source.tokens,
                "note": None,
                "restoredFromRevisionId": source.id,
            },
            {},
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
        # 切り替え前に字余り（A1）へ付けた「意図的」「誤検出」を、新しいコード（A5・A6）に写す
        legacy = [*(parent_sync.findings if parent_sync else []), *self._own_sync_findings(tanka_id, revision.id)]
        self._carry_over_feedback(tanka_id, findings, legacy, ctx.feedback)
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
        saved = self.repo.add_check_run_if_active(tanka_id, revision.id, run)
        if saved is None:
            raise NotFound(tanka_id)
        return saved

    def _own_sync_findings(self, tanka_id: str, revision_id: str) -> list[Finding]:
        """その稿のこれまでの同期の指摘（再チェックのとき、切り替え前の結果を読み替えに使う）。"""
        latest = _latest(self.repo.list_check_runs(tanka_id, revision_id), "sync")
        return latest.findings if latest else []

    def _carry_over_feedback(self, tanka_id: str, findings: list[Finding], legacy: list[Finding],
                             feedback: dict[str, Feedback]) -> None:
        """古いコードの指摘に付けた作者の判断を、読み替えた先の新しいコードにも付ける。

        元の判断は消さない（切り替え前の稿の結果では、元のコードのまま折りたたむため）。
        """
        targets = {f.fingerprint for f in findings}
        for old in legacy:
            new = current_fingerprint(old)
            if new == old.fingerprint or new not in targets or new in feedback or old.fingerprint not in feedback:
                continue
            carried = feedback[old.fingerprint].model_copy(update={"fingerprint": new})
            self.repo.set_feedback(tanka_id, carried)
            feedback[new] = carried

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
        saved = self.repo.add_check_run_if_active(tanka_id, revision.id, run)
        if saved is None:
            raise NotFound(tanka_id)
        run = saved
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
        if tanka.deletedAt is not None:
            return run.model_copy(update={"status": "skipped"})  # 削除中。何も書かない
        revision = self.repo.get_revision(tanka_id, revision_id)

        def finish(status: str, **fields) -> CheckRun:
            done = run.model_copy(update={"status": status, "finishedAt": _now(), **fields})
            # 実行中に短歌が削除されていたら書かない（削除したはずの checkRuns を残さない）
            self.repo.update_check_run_if_active(tanka_id, revision_id, done)
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
        # サービス全体の上限（利用者IDとは重ならない名前で数える）
        if self.repo.increment_daily_usage(GLOBAL_USAGE_KEY, day) > self.settings.async_global_daily_limit:
            log.warning("サービス全体の1日の上限に達しました")
            return finish("limited")

        running = run.model_copy(update={"status": "running"})
        if not self.repo.update_check_run_if_active(tanka_id, revision_id, running):
            return running
        try:
            outcome = run_async(ctx, self.llm, previous)
        except LLMError as e:
            log.warning("LLM check failed: %s", e)
            return finish("failed", error=str(e))
        return finish("done", findings=outcome.findings, resolvedFingerprints=outcome.resolved)

    # --- 作者の判断 ---
    def set_feedback(self, user_id: str, tanka_id: str, fingerprint: str, status: str, comment: str | None,
                     revision_id: str | None = None) -> Feedback:
        self._own_tanka(user_id, tanka_id)
        revision_no = None
        if revision_id is not None:
            try:
                revision_no = self.repo.get_revision(tanka_id, revision_id).revisionNo
            except NotFound as e:
                raise BadRequest("稿が見つかりません") from e
        fb = Feedback(fingerprint=fingerprint, status=status, comment=(comment or "").strip() or None,
                      revisionNo=revision_no, createdAt=_now())
        self.repo.set_feedback(tanka_id, fb)
        return fb

    def delete_feedback(self, user_id: str, tanka_id: str, fingerprint: str) -> None:
        self._own_tanka(user_id, tanka_id)
        self.repo.delete_feedback(tanka_id, fingerprint)

    # --- 削除 ---
    def delete_tanka(self, user_id: str, tanka_id: str) -> None:
        """短歌を削除する。すべての稿・チェック結果・作者の判断をまとめて消す（元に戻せない）。

        1. deletedAt を立てる（一覧から即座に消え、以降の書き込みを拒否する目印）
        2. 連作からその歌を外し、配下をまとめて消す（発表記録は本文の写しとともに残す）
        3. 途中で失敗したら、削除のタスクを登録して再試行する
        """
        self._own_tanka(user_id, tanka_id)
        self.repo.mark_deleted(tanka_id, _now())
        self._purge_or_retry(tanka_id)

    def _detach_and_purge(self, tanka_id: str) -> None:
        """連作からその歌を外してから、短歌と配下を消す。発表記録は本文の写しとともに残す。"""
        try:
            tanka = self.repo.get_tanka(tanka_id)
        except NotFound:
            return
        for sequence_id in tanka.sequenceIds:
            self.repo.remove_tanka_from_sequence(sequence_id, tanka_id)
        self.repo.purge_tanka(tanka_id)

    def _purge_or_retry(self, tanka_id: str) -> None:
        try:
            self._detach_and_purge(tanka_id)
        except Exception:
            log.exception("短歌の削除に失敗しました。再試行を登録します: %s", tanka_id)
            self.enqueuer.enqueue({"kind": "purge", "tankaId": tanka_id}, 30)

    def purge_tanka(self, tanka_id: str) -> None:
        """削除のタスク（ワーカー）。削除中の目印がある短歌だけを消す。"""
        try:
            tanka = self.repo.get_tanka(tanka_id)
        except NotFound:
            return
        if tanka.deletedAt is None:
            return  # 目印のない短歌は消さない
        self._detach_and_purge(tanka_id)

    def cleanup_deleted(self, older_than: timedelta = timedelta(minutes=10)) -> int:
        """deletedAt が立ったまま残っている短歌を消し直す（定期ジョブ）。"""
        ids = self.repo.list_deleted_tankas(_now() - older_than)
        for tanka_id in ids:
            try:
                self._detach_and_purge(tanka_id)
            except Exception:
                log.exception("短歌の消し直しに失敗しました: %s", tanka_id)
        return len(ids)

    # --- 連作 ---
    def _own_sequence(self, user_id: str, sequence_id: str) -> Sequence:
        seq = self.repo.get_sequence(sequence_id)
        if seq.authorId != user_id:
            raise Forbidden(sequence_id)
        return seq

    def _sequence_items(self, user_id: str, items: list[tuple[str, str | None]]) -> list[SequenceItem]:
        """歌の並びを確かめる。稿を指定しなければ、その時点のいまの稿を入れる。"""
        if len(items) > MAX_SEQUENCE_ITEMS:
            raise BadRequest(f"1つの連作に入れられるのは{MAX_SEQUENCE_ITEMS}首までです")
        tanka_ids = [t for t, _ in items]
        if len(set(tanka_ids)) != len(tanka_ids):
            raise BadRequest("同じ歌が2回入っています")
        out = []
        for tanka_id, revision_id in items:
            try:
                tanka = self._own_tanka(user_id, tanka_id)
            except NotFound as e:
                raise BadRequest("歌が見つかりません") from e
            revision_id = revision_id or tanka.currentRevisionId
            if revision_id is None:
                raise BadRequest("まだ稿のない歌は入れられません")
            try:
                self.repo.get_revision(tanka_id, revision_id)
            except NotFound as e:
                raise BadRequest("稿が見つかりません") from e
            out.append(SequenceItem(tankaId=tanka_id, revisionId=revision_id))
        return out

    def create_sequence(self, user_id: str, title: str, items: list[tuple[str, str | None]], note: str | None) -> Sequence:
        now = _now()
        seq = Sequence(id="", authorId=user_id, title=title.strip(), items=self._sequence_items(user_id, items),
                       note=(note or "").strip() or None, createdAt=now, updatedAt=now)
        try:
            return self.repo.create_sequence(seq)
        except NotFound as e:
            raise BadRequest("歌が見つかりません") from e

    def update_sequence(self, user_id: str, sequence_id: str, title: str, items: list[tuple[str, str | None]],
                        note: str | None) -> Sequence:
        seq = self._own_sequence(user_id, sequence_id)
        updated = seq.model_copy(update={
            "title": title.strip(),
            "items": self._sequence_items(user_id, items),
            "note": (note or "").strip() or None,
            "updatedAt": _now(),
        })
        try:
            return self.repo.update_sequence(updated)
        except NotFound as e:
            raise BadRequest("歌が見つかりません") from e

    def delete_sequence(self, user_id: str, sequence_id: str) -> None:
        """連作を削除する。中の短歌と発表記録は消えない。"""
        self._own_sequence(user_id, sequence_id)
        self.repo.delete_sequence(sequence_id)

    # --- 発表記録 ---
    def _own_publication(self, user_id: str, publication_id: str) -> Publication:
        pub = self.repo.get_publication(publication_id)
        if pub.authorId != user_id:
            raise Forbidden(publication_id)
        return pub

    def check_publications(self, user_id: str, tanka_ids: list[str]) -> list[Publication]:
        """二重投稿の確認。同じ短歌（稿が違っても）を含む発表記録を返す。"""
        found: dict[str, Publication] = {}
        for tanka_id in dict.fromkeys(tanka_ids):
            for pub in self.repo.list_publications_by_tanka(user_id, tanka_id):
                found[pub.id] = pub
        return sorted(found.values(), key=lambda p: (p.submittedOn, p.createdAt), reverse=True)

    def _publication_items(self, user_id: str, items: list[tuple[str, str]]) -> list[PublicationItem]:
        out = []
        for tanka_id, revision_id in items:
            try:
                self._own_tanka(user_id, tanka_id)
                rev = self.repo.get_revision(tanka_id, revision_id)
            except NotFound as e:
                raise BadRequest("歌または稿が見つかりません") from e
            out.append(PublicationItem(tankaId=tanka_id, revisionId=rev.id, revisionNo=rev.revisionNo,
                                       body=rev.bodyNormalized))
        return out

    def create_publication(self, user_id: str, *, destination: str, submitted_on: str, note: str | None,
                           items: list[tuple[str, str]] | None = None, sequence_id: str | None = None) -> Publication:
        """発表を記録する。連作なら、その時点の題と中身（各歌の稿）を写す。"""
        sequence_title = None
        if sequence_id is not None:
            try:
                seq = self._own_sequence(user_id, sequence_id)
            except NotFound as e:
                raise BadRequest("連作が見つかりません") from e
            items = [(i.tankaId, i.revisionId) for i in seq.items]
            sequence_title = seq.title
        if not items:
            raise BadRequest("出した歌を選んでください")
        if len(items) > MAX_SEQUENCE_ITEMS:
            raise BadRequest(f"1回に記録できるのは{MAX_SEQUENCE_ITEMS}首までです")
        pub_items = self._publication_items(user_id, items)
        now = _now()
        pub = Publication(
            id="", authorId=user_id, destination=destination.strip(), submittedOn=submitted_on,
            note=(note or "").strip() or None, sequenceId=sequence_id, sequenceTitle=sequence_title,
            items=pub_items, tankaIds=list(dict.fromkeys(i.tankaId for i in pub_items)),
            createdAt=now, updatedAt=now,
        )
        return self.repo.create_publication(pub)

    def update_publication(self, user_id: str, publication_id: str, *, destination: str, submitted_on: str,
                           note: str | None) -> Publication:
        """出し先・出した日・フリーテキストを直す。中身の稿は直せない。"""
        pub = self._own_publication(user_id, publication_id)
        updated = pub.model_copy(update={
            "destination": destination.strip(),
            "submittedOn": submitted_on,
            "note": (note or "").strip() or None,
            "updatedAt": _now(),
        })
        return self.repo.update_publication(updated)

    def delete_publication(self, user_id: str, publication_id: str) -> None:
        self._own_publication(user_id, publication_id)
        self.repo.delete_publication(publication_id)

    # --- アカウント ---
    def export_user(self, user_id: str) -> dict[str, Any]:
        """自分のすべての短歌と稿を書き出す。"""
        tankas = []
        for t in self.repo.list_tankas_by_author(user_id):
            revisions = self.repo.list_revisions(t.id)
            tankas.append({
                "id": t.id,
                "createdAt": t.createdAt.isoformat(),
                "updatedAt": t.updatedAt.isoformat(),
                "revisions": [
                    {
                        "revisionNo": r.revisionNo,
                        "body": r.body,
                        "reading": r.reading,
                        "segments": [{"no": s.no, "text": s.text, "reading": s.reading, "mora": s.mora} for s in r.segments],
                        "style": r.style,
                        "orthography": r.orthography,
                        "note": r.note,
                        "createdAt": r.createdAt.isoformat(),
                    }
                    for r in revisions
                ],
            })
        sequences = [s.model_dump(mode="json") for s in self.repo.list_sequences_by_author(user_id)]
        publications = [p.model_dump(mode="json") for p in self.repo.list_publications_by_author(user_id)]
        return {"exportedAt": _now().isoformat(), "tankas": tankas, "sequences": sequences, "publications": publications}

    def delete_account(self, user_id: str, delete_auth_user: Callable[[str], None]) -> None:
        """アカウント削除。すべての短歌を削除し、Firebase Authentication のユーザーも消す。"""
        for t in self.repo.list_tankas_by_author(user_id):
            self.repo.mark_deleted(t.id, _now())
            self._purge_or_retry(t.id)
        for seq in self.repo.list_sequences_by_author(user_id):
            self.repo.delete_sequence(seq.id)
        for pub in self.repo.list_publications_by_author(user_id):
            self.repo.delete_publication(pub.id)
        self.repo.delete_user_data(user_id)
        delete_auth_user(user_id)
