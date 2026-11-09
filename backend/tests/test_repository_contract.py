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
    assert got.restoredFromRevisionId is None
    # 「この稿に戻す」で作った稿は、戻した先を持つ
    r3 = repo.create_revision(t.id, {**revision_data(BODY1, parent=r1.id), "restoredFromRevisionId": r1.id}, {})
    assert repo.get_revision(t.id, r3.id).restoredFromRevisionId == r1.id
    assert repo.get_tanka(t.id).currentRevisionId == r3.id


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


def test_service_total_usage_key_is_accepted(repo):
    """サービス全体の回数を数えるキーが、Firestore で使えるドキュメントIDであること
    （__ で始まり __ で終わるIDは Firestore が予約していて書けない）。"""
    from app.service import GLOBAL_USAGE_KEY

    assert repo.increment_daily_usage(GLOBAL_USAGE_KEY, "2026-11-07") == 1
    assert repo.increment_daily_usage(GLOBAL_USAGE_KEY, "2026-11-07") == 2


def test_usage_fields_are_counted_separately(repo):
    """鑑賞の回数（appreciations）と非同期チェックの回数（asyncChecks）は別に数え、互いを消さない。"""
    assert repo.increment_daily_usage("u1", "2026-11-09") == 1
    assert repo.increment_daily_usage("u1", "2026-11-09", "appreciations") == 1
    assert repo.increment_daily_usage("u1", "2026-11-09", "appreciations") == 2
    assert repo.increment_daily_usage("u1", "2026-11-09") == 2


# --- 鑑賞 ---
def _appreciation(revision_id: str, status: str = "pending"):
    from app.models import Appreciation

    now = datetime.now(UTC)
    return Appreciation(revisionId=revision_id, status=status, createdAt=now, updatedAt=now)


def test_appreciation_round_trip(repo):
    from app.models import AppreciationPause, AppreciationSplit

    t = repo.create_tanka("u1")
    r = repo.create_revision(t.id, revision_data(BODY1), {})
    assert repo.get_appreciation(t.id, r.id) is None
    a, created = repo.create_appreciation_if_absent(t.id, _appreciation(r.id))
    assert created and a.status == "pending"
    # 2回目は既存のものを返し、書き換えない
    again, created = repo.create_appreciation_if_absent(t.id, _appreciation(r.id, "failed"))
    assert not created and again.status == "pending"
    done = a.model_copy(update={
        "status": "done", "scene": "夕方の駅", "feeling": "寂しさ",
        "pauses": [AppreciationPause(tokenStart=0, tokenEnd=1, span=(0, 3), text="夕暮れ", reason="理由")],
        "splits": [AppreciationSplit(tokenStart=2, tokenEnd=2, span=(4, 5), text="駅", readings=["a", "b"])],
    })
    assert repo.update_appreciation_if_active(t.id, done)
    got = repo.get_appreciation(t.id, r.id)
    assert got.status == "done" and got.pauses[0].span == (0, 3) and got.splits[0].readings == ["a", "b"]
    noted = repo.set_appreciation_note(t.id, r.id, "伝えたかったこと", datetime.now(UTC))
    assert noted.authorNote == "伝えたかったこと" and noted.scene == "夕方の駅"
    assert [x.revisionId for x in repo.list_appreciations(t.id)] == [r.id]
    with pytest.raises(NotFound):
        repo.set_appreciation_note(t.id, "nope", "x", datetime.now(UTC))


def test_failed_appreciation_can_be_replaced(repo):
    t = repo.create_tanka("u1")
    r = repo.create_revision(t.id, revision_data(BODY1), {})
    repo.create_appreciation_if_absent(t.id, _appreciation(r.id, "failed"))
    a, created = repo.create_appreciation_if_absent(t.id, _appreciation(r.id), replace_failed=True)
    assert created and a.status == "pending"


def test_appreciation_is_refused_and_purged_with_tanka(repo):
    t = repo.create_tanka("u1")
    r = repo.create_revision(t.id, revision_data(BODY1), {})
    a, _ = repo.create_appreciation_if_absent(t.id, _appreciation(r.id))
    repo.mark_deleted(t.id, datetime.now(UTC))
    assert not repo.update_appreciation_if_active(t.id, a.model_copy(update={"status": "done"}))
    with pytest.raises(NotFound):
        repo.create_appreciation_if_absent(t.id, _appreciation("other"))
    with pytest.raises(NotFound):
        repo.set_appreciation_note(t.id, r.id, "x", datetime.now(UTC))
    repo.purge_tanka(t.id)
    assert repo.list_appreciations(t.id) == []


# --- 連作と発表 ---
def _seq(author: str, items: list[tuple[str, str]], title: str = "駅の灯"):
    from app.models import Sequence, SequenceItem

    now = datetime.now(UTC)
    return Sequence(id="", authorId=author, title=title, items=[SequenceItem(tankaId=t, revisionId=r) for t, r in items],
                    createdAt=now, updatedAt=now)


def _pub(author: str, items: list[tuple[str, str]], destination: str = "みなと新聞 歌壇", on: str = "2026-11-07"):
    from app.models import Publication, PublicationItem

    now = datetime.now(UTC)
    return Publication(id="", authorId=author, destination=destination, submittedOn=on,
                       items=[PublicationItem(tankaId=t, revisionId=r, revisionNo=1, body=BODY1) for t, r in items],
                       tankaIds=list(dict.fromkeys(t for t, _ in items)), createdAt=now, updatedAt=now)


def test_sequence_updates_tanka_sequence_ids(repo):
    a, b, c = (repo.create_tanka("u1") for _ in range(3))
    ra, rb, rc = (repo.create_revision(t.id, revision_data(BODY1), {}) for t in (a, b, c))
    seq = repo.create_sequence(_seq("u1", [(a.id, ra.id), (b.id, rb.id)]))
    assert seq.id
    assert repo.get_tanka(a.id).sequenceIds == [seq.id] and repo.get_tanka(c.id).sequenceIds == []
    # b を外して c を加える
    seq2 = seq.model_copy(update={"items": [i for i in seq.items if i.tankaId == a.id] + _seq("u1", [(c.id, rc.id)]).items,
                                  "title": "改題"})
    repo.update_sequence(seq2)
    got = repo.get_sequence(seq.id)
    assert got.title == "改題" and [i.tankaId for i in got.items] == [a.id, c.id]
    assert repo.get_tanka(b.id).sequenceIds == [] and repo.get_tanka(c.id).sequenceIds == [seq.id]
    assert [s.id for s in repo.list_sequences_by_author("u1")] == [seq.id]
    # 短歌の削除に伴って外す
    repo.remove_tanka_from_sequence(seq.id, c.id)
    assert [i.tankaId for i in repo.get_sequence(seq.id).items] == [a.id]
    repo.delete_sequence(seq.id)
    assert repo.get_tanka(a.id).sequenceIds == []
    with pytest.raises(NotFound):
        repo.get_sequence(seq.id)
    repo.delete_sequence(seq.id)  # 何度呼んでもよい


def test_sequence_refuses_deleted_tanka(repo):
    t = repo.create_tanka("u1")
    r = repo.create_revision(t.id, revision_data(BODY1), {})
    repo.mark_deleted(t.id, datetime.now(UTC))
    with pytest.raises(NotFound):
        repo.create_sequence(_seq("u1", [(t.id, r.id)]))


def test_publication_counts_and_destinations(repo):
    a, b = repo.create_tanka("u1"), repo.create_tanka("u1")
    ra, rb = repo.create_revision(a.id, revision_data(BODY1), {}), repo.create_revision(b.id, revision_data(BODY2), {})
    repo.increment_daily_usage("u1", "2026-11-07")
    p1 = repo.create_publication(_pub("u1", [(a.id, ra.id)], "みなと新聞 歌壇", "2026-11-07"))
    p2 = repo.create_publication(_pub("u1", [(a.id, ra.id), (b.id, rb.id)], "短歌結社誌「潮」", "2026-11-08"))
    assert repo.get_tanka(a.id).publishedCount == 2 and repo.get_tanka(b.id).publishedCount == 1
    assert repo.get_destinations("u1") == ["短歌結社誌「潮」", "みなと新聞 歌壇"]
    # 1日の回数を数えても、出し先の候補は消えない
    repo.increment_daily_usage("u1", "2026-11-08")
    assert repo.get_destinations("u1") == ["短歌結社誌「潮」", "みなと新聞 歌壇"]
    assert [p.id for p in repo.list_publications_by_author("u1")] == [p2.id, p1.id]
    assert [p.id for p in repo.list_publications_by_tanka("u1", b.id)] == [p2.id]
    assert repo.list_publications_by_tanka("u2", a.id) == []
    # 出し先を直すと、候補の先頭に来る
    repo.update_publication(p1.model_copy(update={"destination": "みなと新聞 歌壇", "note": "入選"}))
    assert repo.get_publication(p1.id).note == "入選"
    assert repo.get_destinations("u1")[0] == "みなと新聞 歌壇"
    repo.delete_publication(p2.id)
    assert repo.get_tanka(a.id).publishedCount == 1 and repo.get_tanka(b.id).publishedCount == 0
    repo.delete_publication(p2.id)  # 何度呼んでもよい
    # 短歌を消しても記録は残る
    repo.mark_deleted(a.id, datetime.now(UTC))
    repo.purge_tanka(a.id)
    assert repo.get_publication(p1.id).items[0].body == BODY1
