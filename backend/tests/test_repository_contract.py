"""リポジトリ層の契約テスト。メモリ実装と Firestore 実装に同じテストを流す。

Firestore 実装は Firestore エミュレータに対して動かす。FIRESTORE_EMULATOR_HOST が
設定されていなければ Firestore の分は飛ばす（メモリの分だけ動く）。

  firebase emulators:exec --only firestore --project demo-tanka-suiko \\
    "cd backend && .venv/bin/python -m pytest tests/test_repository_contract.py"

（scripts/test_firestore.sh が同じことをする）
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models import CheckRun, Feedback, Finding
from app.preprocess.pipeline import ConfirmedSegment, build_from_confirmed, preprocess
from app.repository.base import NotFound
from app.repository.memory import MemoryRepository

EMULATOR = os.environ.get("FIRESTORE_EMULATOR_HOST")
PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "demo-tanka-suiko")
BODY1 = "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて"
BODY2 = "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"


def _clear_emulator() -> None:
    import requests

    url = f"http://{EMULATOR}/emulator/v1/projects/{PROJECT}/databases/(default)/documents"
    requests.delete(url, timeout=10).raise_for_status()


@pytest.fixture(params=["memory", "firestore"])
def repo(request):
    if request.param == "memory":
        return MemoryRepository()
    if not EMULATOR:
        pytest.skip("FIRESTORE_EMULATOR_HOST が未設定（Firestore エミュレータで動かすときだけ実行）")
    from google.cloud import firestore

    from app.repository.firestore import FirestoreRepository

    _clear_emulator()
    return FirestoreRepository(firestore.Client(project=PROJECT))


def revision_data(body: str, parent: str | None = None, note: str | None = None) -> dict:
    pre = preprocess(body)
    built = build_from_confirmed(body, [ConfirmedSegment(s.no, s.text, s.reading) for s in pre.segments], style=pre.style)
    return {
        "parentRevisionId": parent,
        "body": built.body,
        "bodyNormalized": built.bodyNormalized,
        "reading": built.reading,
        "orthography": pre.orthography,
        "style": pre.style,
        "segments": built.segments,
        "tokens": built.tokens,
        "note": note,
    }


def make_run(phase: str = "sync", status: str = "done", fps: tuple[str, ...] = ("A1:5",)) -> CheckRun:
    return CheckRun(
        id="",
        phase=phase,
        rulesetVersion="test",
        status=status,
        findings=[
            Finding(code=fp.split(":")[0], severity="medium", segmentNo=5, span=(20, 27), matchedText="何度も読み返す",
                    message="m", evidence={"lemma": "x"}, fingerprint=fp)
            for fp in fps
        ],
        resolvedFingerprints=["C3:1"],
        startedAt=datetime.now(UTC),
    )


def test_create_and_get_tanka(repo):
    t = repo.create_tanka("u1")
    got = repo.get_tanka(t.id)
    assert got.authorId == "u1"
    assert got.currentRevisionId is None and got.latestBody is None and got.deletedAt is None
    assert got.nextRevisionNo == 1
    with pytest.raises(NotFound):
        repo.get_tanka("missing-" + uuid.uuid4().hex)


def test_create_revision_numbers_and_updates_tanka(repo):
    t = repo.create_tanka("u1")
    r1 = repo.create_revision(t.id, revision_data(BODY1), {})
    r2 = repo.create_revision(t.id, revision_data(BODY2, parent=r1.id, note="メモ"), {})
    assert (r1.revisionNo, r2.revisionNo) == (1, 2)
    tanka = repo.get_tanka(t.id)
    assert tanka.currentRevisionId == r2.id
    assert tanka.latestBody == BODY2 and tanka.latestRevisionNo == 2
    assert tanka.nextRevisionNo == 3
    revs = repo.list_revisions(t.id)
    assert [r.revisionNo for r in revs] == [1, 2]
    got = repo.get_revision(t.id, r2.id)
    assert got.parentRevisionId == r1.id and got.note == "メモ"
    assert got.segments[4].span == (20, 27) and got.tokens[0].span == (0, 3)


def test_reading_memory_is_merged(repo):
    """読みの選択つきの保存（79ebd77 で直した不具合の再発防止）。"""
    t = repo.create_tanka("u1")
    repo.create_revision(t.id, revision_data(BODY2), {"文字": "もんじ"})
    repo.create_revision(t.id, revision_data(BODY2), {"寂しく": "さみしく"})
    assert repo.get_tanka(t.id).readingMemory == {"文字": "もんじ", "寂しく": "さみしく"}
    # 記号を含む表層形もキーにできる
    repo.create_revision(t.id, revision_data(BODY2), {"文字": "もじ", "a.b": "えーびー"})
    assert repo.get_tanka(t.id).readingMemory == {"文字": "もじ", "寂しく": "さみしく", "a.b": "えーびー"}


def test_list_tankas_by_author_excludes_others_and_deleted(repo):
    a = repo.create_tanka("u1")
    b = repo.create_tanka("u1")
    repo.create_tanka("u2")
    repo.create_revision(a.id, revision_data(BODY1), {})
    repo.create_revision(b.id, revision_data(BODY2), {})  # b のほうが新しい
    assert [t.id for t in repo.list_tankas_by_author("u1")] == [b.id, a.id]
    repo.mark_deleted(b.id, datetime.now(UTC))
    assert [t.id for t in repo.list_tankas_by_author("u1")] == [a.id]


def test_check_runs_round_trip(repo):
    t = repo.create_tanka("u1")
    r = repo.create_revision(t.id, revision_data(BODY2), {})
    run = repo.add_check_run_if_active(t.id, r.id, make_run())
    assert run is not None and run.id
    queued = repo.add_check_run_if_active(t.id, r.id, make_run("async", "queued", ()))
    done = queued.model_copy(update={"status": "done", "findings": make_run(fps=("B1:寂しい",)).findings})
    assert repo.update_check_run_if_active(t.id, r.id, done)
    runs = repo.list_check_runs(t.id, r.id)
    assert [x.phase for x in runs] == ["sync", "async"]
    assert runs[0].findings[0].span == (20, 27)
    assert runs[0].resolvedFingerprints == ["C3:1"]
    assert runs[1].status == "done" and runs[1].findings[0].fingerprint == "B1:寂しい"


def test_writes_are_refused_after_delete_mark(repo):
    t = repo.create_tanka("u1")
    r = repo.create_revision(t.id, revision_data(BODY1), {})
    run = repo.add_check_run_if_active(t.id, r.id, make_run("async", "queued", ()))
    repo.mark_deleted(t.id, datetime.now(UTC))
    assert repo.add_check_run_if_active(t.id, r.id, make_run()) is None
    assert not repo.update_check_run_if_active(t.id, r.id, run.model_copy(update={"status": "done"}))
    assert [x.status for x in repo.list_check_runs(t.id, r.id)] == ["queued"]
    with pytest.raises(NotFound):
        repo.create_revision(t.id, revision_data(BODY2), {})
    with pytest.raises(NotFound):
        repo.set_feedback(t.id, Feedback(fingerprint="A1:5", status="intentional", createdAt=datetime.now(UTC)))


def test_feedback_round_trip(repo):
    t = repo.create_tanka("u1")
    fb = Feedback(fingerprint="B1:寂しい", status="intentional", comment="あえて", revisionNo=2, createdAt=datetime.now(UTC))
    repo.set_feedback(t.id, fb)
    repo.set_feedback(t.id, Feedback(fingerprint="A1:5", status="false_positive", createdAt=datetime.now(UTC)))
    got = {f.fingerprint: f for f in repo.list_feedback(t.id)}
    assert got["B1:寂しい"].status == "intentional" and got["B1:寂しい"].revisionNo == 2
    assert got["B1:寂しい"].comment == "あえて"
    repo.delete_feedback(t.id, "B1:寂しい")
    assert [f.fingerprint for f in repo.list_feedback(t.id)] == ["A1:5"]


def test_purge_removes_subcollections(repo):
    t = repo.create_tanka("u1")
    r = repo.create_revision(t.id, revision_data(BODY1), {})
    repo.add_check_run_if_active(t.id, r.id, make_run())
    repo.set_feedback(t.id, Feedback(fingerprint="A1:5", status="intentional", createdAt=datetime.now(UTC)))
    repo.mark_deleted(t.id, datetime.now(UTC))
    repo.purge_tanka(t.id)
    with pytest.raises(NotFound):
        repo.get_tanka(t.id)
    assert repo.list_revisions(t.id) == []
    assert repo.list_check_runs(t.id, r.id) == []
    assert repo.list_feedback(t.id) == []
    repo.purge_tanka(t.id)  # 何度呼んでもよい


def test_list_deleted_tankas(repo):
    old = repo.create_tanka("u1")
    new = repo.create_tanka("u1")
    repo.create_tanka("u1")  # 削除していない
    now = datetime.now(UTC)
    repo.mark_deleted(old.id, now - timedelta(hours=1))
    repo.mark_deleted(new.id, now)
    assert repo.list_deleted_tankas(now - timedelta(minutes=10)) == [old.id]
    # 2回目の目印で日時は変わらない
    repo.mark_deleted(old.id, now)
    assert repo.list_deleted_tankas(now - timedelta(minutes=10)) == [old.id]


def test_daily_usage_and_user_data(repo):
    assert repo.increment_daily_usage("u1", "2026-11-07") == 1
    assert repo.increment_daily_usage("u1", "2026-11-07") == 2
    assert repo.increment_daily_usage("u1", "2026-11-08") == 1
    repo.delete_user_data("u1")
    assert repo.increment_daily_usage("u1", "2026-11-08") == 1
