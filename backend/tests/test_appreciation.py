"""鑑賞：頼んだ稿だけを読み、評価や改作案は持たない。語句は形態素の番号から文字位置を復元する。"""

import pytest
from fastapi.testclient import TestClient

from app.appreciation import build_user_prompt, validate_output
from app.checkers.llm import LLMError
from app.config import Settings
from app.main import create_app
from app.repository.base import NotFound
from app.service import LimitReached

from .helpers import make_revision
from .test_delete import AUTH, BODY1, BODY2, USER, save


def reading(system, user, schema):
    if "scene" not in schema["properties"]:
        return {"findings": []}
    return {
        "scene": "夕方の駅のホームで、届いた言葉を読み返している。",
        "feeling": "会えない相手を思う寂しさ。",
        "pauses": [{"tokenStart": 0, "tokenEnd": 0, "reason": "時間の手がかり"}, {"tokenStart": 99, "tokenEnd": 99, "reason": "範囲外"}],
        "splits": [
            {"tokenStart": 2, "tokenEnd": 2, "readings": ["理由として読む", "様子として読む"]},
            {"tokenStart": 1, "tokenEnd": 1, "readings": ["ひとつだけ"]},  # 2通りに満たないので捨てる
        ],
    }


@pytest.fixture
def appreciating(service, fake_llm):
    fake_llm.responder = reading
    return service


def test_request_runs_once_and_returns_existing(appreciating, fake_llm):
    t = appreciating.create_tanka(USER)
    rev = save(appreciating, t.id, BODY2).revision
    calls = len(fake_llm.calls)
    a, created = appreciating.request_appreciation(USER, t.id, rev.id)
    assert created
    got = appreciating.repo.get_appreciation(t.id, rev.id)
    assert got.status == "done" and got.reader == "experienced"
    assert got.scene.startswith("夕方") and len(got.pauses) == 1 and len(got.splits) == 1
    # 語句は番号から本文の文字列と位置を復元する
    tok = rev.tokens[0]
    assert got.pauses[0].text == tok.surface and got.pauses[0].span == tok.span
    assert len(fake_llm.calls) == calls + 1
    # 2回目は既存のものを返し、LLMを呼ばない
    again, created = appreciating.request_appreciation(USER, t.id, rev.id)
    assert not created and again.status == "done" and len(fake_llm.calls) == calls + 1


def test_prompt_has_no_findings_memo_or_previous(appreciating, fake_llm):
    t = appreciating.create_tanka(USER)
    r1 = save(appreciating, t.id, BODY1).revision
    appreciating.request_appreciation(USER, t.id, r1.id)
    appreciating.set_appreciation_note(USER, t.id, r1.id, "伝えたかったこと：待つ時間")
    r2 = save(appreciating, t.id, BODY2, parent=r1.id).revision
    appreciating.request_appreciation(USER, t.id, r2.id)
    user = fake_llm.calls[-1]["user"]
    assert BODY2 in user and BODY1 not in user
    assert "待つ時間" not in user and "指摘" not in user


def test_daily_limit(service, fake_llm):
    fake_llm.responder = reading
    service.settings = Settings(tasks_mode="sync", async_delay_seconds=0, appreciation_daily_limit=2)
    t = service.create_tanka(USER)
    revs = [save(service, t.id, b).revision for b in (BODY1, BODY2, BODY1)]
    service.request_appreciation(USER, t.id, revs[0].id)
    service.request_appreciation(USER, t.id, revs[1].id)
    service.request_appreciation(USER, t.id, revs[1].id)  # 既存のものは数えない
    with pytest.raises(LimitReached):
        service.request_appreciation(USER, t.id, revs[2].id)
    assert service.repo.get_appreciation(t.id, revs[2].id) is None


def test_failed_then_retry(appreciating, fake_llm):
    t = appreciating.create_tanka(USER)
    rev = save(appreciating, t.id, BODY2).revision
    fake_llm.responder = lambda s, u, schema: {"scene": "", "feeling": "", "pauses": [], "splits": []}
    appreciating.request_appreciation(USER, t.id, rev.id)
    failed = appreciating.repo.get_appreciation(t.id, rev.id)
    assert failed.status == "failed" and failed.error
    fake_llm.responder = reading
    a, created = appreciating.request_appreciation(USER, t.id, rev.id)
    assert created and appreciating.repo.get_appreciation(t.id, rev.id).status == "done"


def test_note_and_ownership(appreciating):
    t = appreciating.create_tanka(USER)
    rev = save(appreciating, t.id, BODY2).revision
    with pytest.raises(NotFound):
        appreciating.set_appreciation_note(USER, t.id, rev.id, "まだ頼んでいない")
    appreciating.request_appreciation(USER, t.id, rev.id)
    assert appreciating.set_appreciation_note(USER, t.id, rev.id, "  メモ  ").authorNote == "メモ"
    assert appreciating.set_appreciation_note(USER, t.id, rev.id, "").authorNote is None
    from app.service import Forbidden

    with pytest.raises(Forbidden):
        appreciating.request_appreciation("u2", t.id, rev.id)


def test_deleted_tanka_is_not_written(appreciating):
    t = appreciating.create_tanka(USER)
    rev = save(appreciating, t.id, BODY2).revision
    appreciating.enqueuer.handler = lambda p: None  # まだ実行しない
    appreciating.request_appreciation(USER, t.id, rev.id)
    appreciating.delete_tanka(USER, t.id)
    assert appreciating.run_appreciation(t.id, rev.id) is None


def test_export_includes_appreciations(appreciating):
    t = appreciating.create_tanka(USER)
    rev = save(appreciating, t.id, BODY2).revision
    appreciating.request_appreciation(USER, t.id, rev.id)
    data = appreciating.export_user(USER)
    assert data["tankas"][0]["appreciations"][0]["revisionId"] == rev.id


def test_validate_output():
    rev = make_revision(BODY2)
    with pytest.raises(LLMError):
        validate_output({"scene": "x", "feeling": "", "pauses": [], "splits": []}, rev)
    out = validate_output({"scene": "場面", "feeling": "気持ち", "pauses": [{"tokenStart": 1, "tokenEnd": 0, "reason": "逆"}],
                           "splits": [{"tokenStart": 0, "tokenEnd": 1, "readings": ["a", "b", "c", "d"]}]}, rev)
    assert out["pauses"] == [] and out["splits"][0].readings == ["a", "b", "c"]
    assert out["splits"][0].text == rev.bodyNormalized[out["splits"][0].span[0]:out["splits"][0].span[1]]
    assert "0\t" in build_user_prompt(rev)


def test_api(appreciating):
    c = TestClient(create_app(Settings(tasks_mode="sync", async_delay_seconds=0), service=appreciating))
    tid = c.post("/tankas", headers=AUTH).json()["tankaId"]
    rid = save(appreciating, tid, BODY2).revision.id
    url = f"/tankas/{tid}/revisions/{rid}/appreciation"
    first = c.post(url, headers=AUTH)
    assert first.status_code == 202 and first.json()["revisionId"] == rid
    second = c.post(url, headers=AUTH)
    assert second.status_code == 200 and second.json()["status"] == "done"
    note = c.patch(url + "/note", json={"note": "伝えたかったこと"}, headers=AUTH)
    assert note.status_code == 200 and note.json()["authorNote"] == "伝えたかったこと"
    assert c.patch(url + "/note", json={"note": "あ" * 501}, headers=AUTH).status_code == 422
    assert c.post(f"/tankas/{tid}/revisions/nope/appreciation", headers=AUTH).status_code == 404
    assert c.post("/internal/appreciate", json={"tankaId": tid, "revisionId": rid}).json() == {"status": "done"}


def test_api_limit(service, fake_llm):
    fake_llm.responder = reading
    settings = Settings(tasks_mode="sync", async_delay_seconds=0, appreciation_daily_limit=0)
    service.settings = settings
    c = TestClient(create_app(settings, service=service))
    tid = c.post("/tankas", headers=AUTH).json()["tankaId"]
    rid = save(service, tid, BODY2).revision.id
    res = c.post(f"/tankas/{tid}/revisions/{rid}/appreciation", headers=AUTH)
    assert res.status_code == 429 and res.json()["detail"] == "今日はもう鑑賞できません"
