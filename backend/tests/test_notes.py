"""気づき：歌になる前の素材。AIは使わず、初稿の保存で短歌と結ぶ。"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.preprocess.pipeline import ConfirmedSegment, preprocess
from app.repository.base import NotFound
from app.service import BadRequest, Forbidden

from .test_delete import AUTH, BODY1, BODY2, USER, save


def save_from(service, tanka_id, body, note_id, parent=None, user=USER):
    pre = preprocess(body)
    segs = [ConfirmedSegment(s.no, s.text, s.reading) for s in pre.segments]
    return service.create_revision(user, tanka_id, parent_revision_id=parent, body=body, segments=segs,
                                   style=pre.style, orthography=pre.orthography, note=None, source_note_id=note_id)


def test_first_revision_links_note(service, fake_llm):
    n = service.create_note(USER, "  駅で手紙を何度も読み返している人  ")
    assert n.body == "駅で手紙を何度も読み返している人"
    t = service.create_tanka(USER)
    r1 = save_from(service, t.id, BODY1, n.id).revision
    assert service.repo.get_tanka(t.id).sourceNoteId == n.id
    assert service.repo.get_note(n.id).tankaIds == [t.id]
    # 2稿目で別の気づきを渡しても結び直さない
    other = service.create_note(USER, "別の気づき")
    save_from(service, t.id, BODY2, other.id, parent=r1.id)
    assert service.repo.get_tanka(t.id).sourceNoteId == n.id and service.repo.get_note(other.id).tankaIds == []
    # 気づきはLLMに渡さない
    assert all("読み返している人" not in c["user"] for c in fake_llm.calls)


def test_unsaved_tanka_is_not_linked_and_others_note_refused(service):
    n = service.create_note(USER, "気づき")
    service.create_tanka(USER)  # 作っただけで保存しない
    assert service.repo.get_note(n.id).tankaIds == []
    theirs = service.create_note("u2", "ほかの人の気づき")
    t = service.create_tanka(USER)
    with pytest.raises(BadRequest):
        save_from(service, t.id, BODY1, theirs.id)
    with pytest.raises(BadRequest):
        save_from(service, t.id, BODY1, "nope")


def test_delete_tanka_and_note_keep_the_other(service):
    n = service.create_note(USER, "気づき")
    t = service.create_tanka(USER)
    save_from(service, t.id, BODY1, n.id)
    service.delete_tanka(USER, t.id)
    assert service.repo.get_note(n.id).tankaIds == []  # 気づきは残る
    t2 = service.create_tanka(USER)
    save_from(service, t2.id, BODY1, n.id)
    service.delete_note(USER, n.id)
    assert service.repo.get_tanka(t2.id).sourceNoteId is None  # 短歌は残る
    assert service.repo.get_tanka(t2.id).currentRevisionId


def test_update_ownership_and_validation(service):
    n = service.create_note(USER, "気づき")
    assert service.update_note(USER, n.id, "直した").body == "直した"
    with pytest.raises(BadRequest):
        service.update_note(USER, n.id, "   ")
    with pytest.raises(Forbidden):
        service.update_note("u2", n.id, "x")
    with pytest.raises(Forbidden):
        service.delete_note("u2", n.id)
    with pytest.raises(NotFound):
        service.update_note(USER, "nope", "x")


def test_export_and_account_delete(service):
    n = service.create_note(USER, "気づき")
    t = service.create_tanka(USER)
    save_from(service, t.id, BODY1, n.id)
    data = service.export_user(USER)
    assert data["notes"][0]["body"] == "気づき" and data["tankas"][0]["sourceNoteId"] == n.id
    service.delete_account(USER, lambda uid: None)
    assert service.repo.list_notes_by_author(USER) == []


def test_api(service):
    c = TestClient(create_app(Settings(tasks_mode="sync", async_delay_seconds=0), service=service))
    res = c.post("/notes", json={"body": "駅の気づき"}, headers=AUTH)
    assert res.status_code == 201
    nid = res.json()["id"]
    assert c.put(f"/notes/{nid}", json={"body": "直した"}, headers=AUTH).json()["body"] == "直した"
    assert c.post("/notes", json={"body": "あ" * 501}, headers=AUTH).status_code == 422
    assert c.post("/notes", json={"body": "   "}, headers=AUTH).status_code == 422
    tid = c.post("/tankas", headers=AUTH).json()["tankaId"]
    pre = preprocess(BODY1)
    r = c.post(f"/tankas/{tid}/revisions", headers=AUTH, json={
        "body": BODY1, "style": pre.style, "orthography": pre.orthography, "sourceNoteId": nid,
        "segments": [{"no": s.no, "text": s.text, "reading": s.reading} for s in pre.segments],
    })
    assert r.status_code == 201 and service.repo.get_note(nid).tankaIds == [tid]
    assert c.delete(f"/notes/{nid}", headers=AUTH).status_code == 204
    assert c.put(f"/notes/{nid}", json={"body": "x"}, headers=AUTH).status_code == 404
