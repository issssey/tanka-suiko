from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.preprocess.pipeline import ConfirmedSegment, preprocess
from app.repository.base import NotFound

USER = "u1"
AUTH = {"Authorization": "Bearer dev:u1"}
BODY1 = "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて"
BODY2 = "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"


def save(service, tanka_id, body, parent=None, user=USER):
    pre = preprocess(body)
    segs = [ConfirmedSegment(s.no, s.text, s.reading) for s in pre.segments]
    return service.create_revision(user, tanka_id, parent_revision_id=parent, body=body, segments=segs,
                                   style=pre.style, orthography=pre.orthography, note=None)


def test_latest_body_is_copied_to_tanka(service):
    t = service.create_tanka(USER)
    r1 = save(service, t.id, BODY1)
    assert service.repo.get_tanka(t.id).latestBody == BODY1
    save(service, t.id, BODY2, parent=r1.revision.id)
    tanka = service.repo.get_tanka(t.id)
    assert tanka.latestBody == BODY2 and tanka.latestRevisionNo == 2
    assert not hasattr(tanka, "title")


def test_delete_tanka_removes_everything(service):
    t = service.create_tanka(USER)
    r = save(service, t.id, BODY1)
    service.set_feedback(USER, t.id, "C3:1", "intentional", None, r.revision.id)
    service.delete_tanka(USER, t.id)
    repo = service.repo
    with pytest.raises(NotFound):
        repo.get_tanka(t.id)
    assert repo.list_revisions(t.id) == []
    assert repo.list_check_runs(t.id, r.revision.id) == []
    assert repo.list_feedback(t.id) == []
    assert repo.list_tankas_by_author(USER) == []


def test_only_author_can_delete(service):
    from app.service import Forbidden

    t = service.create_tanka(USER)
    with pytest.raises(Forbidden):
        service.delete_tanka("someone", t.id)


def test_failed_purge_is_retried(service):
    t = service.create_tanka(USER)
    save(service, t.id, BODY1)
    queued = []
    service.enqueuer.handler = queued.append
    original = service.repo.purge_tanka
    service.repo.purge_tanka = lambda tid: (_ for _ in ()).throw(RuntimeError("down"))
    service.delete_tanka(USER, t.id)
    # 一覧からは即座に消え、書き込みもできない
    assert service.repo.list_tankas_by_author(USER) == []
    with pytest.raises(NotFound):
        service.preprocess(USER, t.id, BODY1, style=None, orthography=None, reading_overrides=None)
    assert queued == [{"kind": "purge", "tankaId": t.id}]
    service.repo.purge_tanka = original
    service.purge_tanka(t.id)
    with pytest.raises(NotFound):
        service.repo.get_tanka(t.id)


def test_cleanup_job_purges_leftovers(service):
    t = service.create_tanka(USER)
    save(service, t.id, BODY1)
    service.repo.mark_deleted(t.id, datetime.now(UTC) - timedelta(hours=1))
    assert service.cleanup_deleted() == 1
    with pytest.raises(NotFound):
        service.repo.get_tanka(t.id)


def test_purge_task_ignores_tanka_without_mark(service):
    t = service.create_tanka(USER)
    service.purge_tanka(t.id)
    assert service.repo.get_tanka(t.id).id == t.id


def test_async_result_is_not_written_after_delete(service, fake_llm):
    """非同期チェックの実行中に削除されたら、結果を書き込まない。"""
    t = service.create_tanka(USER)

    def delete_during_llm(system, user, schema):
        service.repo.mark_deleted(t.id, datetime.now(UTC))
        return {"findings": [{"code": "B1", "tokenStart": None, "tokenEnd": None, "confidence": 0.9, "reason": "x"}]}

    fake_llm.responder = delete_during_llm
    r = save(service, t.id, BODY1)
    runs = service.repo.list_check_runs(t.id, r.revision.id)
    async_run = [x for x in runs if x.phase == "async"][0]
    assert async_run.status == "running"  # 完了の結果は書かれていない
    assert async_run.findings == []


def test_feedback_records_revision_no(service):
    t = service.create_tanka(USER)
    r1 = save(service, t.id, BODY1)
    r2 = save(service, t.id, BODY2, parent=r1.revision.id)
    fb = service.set_feedback(USER, t.id, "A1:5", "intentional", None, r2.revision.id)
    assert fb.revisionNo == 2
    assert service.repo.list_feedback(t.id)[0].revisionNo == 2


def test_export_and_delete_account(service):
    t1 = service.create_tanka(USER)
    r = save(service, t1.id, BODY1)
    save(service, t1.id, BODY2, parent=r.revision.id)
    other = service.create_tanka("u2")
    save(service, other.id, BODY1, user="u2")

    data = service.export_user(USER)
    assert len(data["tankas"]) == 1
    assert [x["revisionNo"] for x in data["tankas"][0]["revisions"]] == [1, 2]
    assert data["tankas"][0]["revisions"][1]["body"] == BODY2

    deleted = []
    service.delete_account(USER, deleted.append)
    assert deleted == [USER]
    assert service.repo.list_tankas_by_author(USER) == []
    assert len(service.repo.list_tankas_by_author("u2")) == 1  # ほかの人の短歌は消さない


def test_api_delete_export_and_me(service):
    c = TestClient(create_app(Settings(tasks_mode="sync", async_delay_seconds=0), service=service))
    tid = c.post("/tankas", headers=AUTH).json()["tankaId"]
    save(service, tid, BODY1)
    ex = c.get("/me/export", headers=AUTH)
    assert ex.status_code == 200 and "attachment" in ex.headers["content-disposition"]
    assert len(ex.json()["tankas"]) == 1
    assert c.delete(f"/tankas/{tid}", headers=AUTH).status_code == 204
    assert c.delete(f"/tankas/{tid}", headers=AUTH).status_code == 404
    assert c.post(f"/tankas/{tid}/preprocess", json={"body": BODY1}, headers=AUTH).status_code == 404
    assert c.delete("/me", headers=AUTH).status_code == 204
    assert c.post("/internal/cleanup-deleted").json() == {"purged": 0}
