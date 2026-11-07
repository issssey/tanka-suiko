import pytest

from app.checkers.llm import LLMError, output_schema
from app.preprocess.pipeline import ConfirmedSegment, preprocess
from app.service import BadRequest, Forbidden

from .conftest import FakeLLM

USER = "u1"


def confirmed(body, readings=None):
    pre = preprocess(body)
    return pre, [ConfirmedSegment(s.no, s.text, (readings or {}).get(s.no, s.reading)) for s in pre.segments]


def save(service, tanka_id, body, parent=None, note=None):
    pre, segs = confirmed(body)
    return service.create_revision(USER, tanka_id, parent_revision_id=parent, body=body, segments=segs,
                                   style=pre.style, orthography=pre.orthography, note=note)


def llm_returning(findings_by_call):
    """呼び出しごとに返す findings を決める。"""
    calls = iter(findings_by_call)

    def responder(system, user, schema):
        return {"findings": next(calls)}

    return responder


def test_save_runs_sync_and_async(service, fake_llm):
    t = service.create_tanka(USER, "駅のホーム")
    res = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    assert res.revision.revisionNo == 1
    assert res.sync_run.status == "done"
    assert [f.fingerprint for f in res.sync_run.findings] == ["C3:1"]
    runs = service.repo.list_check_runs(t.id, res.revision.id)
    async_run = [r for r in runs if r.phase == "async"][0]
    assert async_run.status == "done"
    assert async_run.llmModel == "fake-model" and async_run.promptVersion
    # 初稿では E系を判定させない
    codes = output_schema_codes(fake_llm.calls[0]["schema"])
    assert "B1" in codes and not any(c.startswith("E") for c in codes)


def output_schema_codes(schema):
    return schema["properties"]["findings"]["items"]["properties"]["code"]["enum"]


def test_llm_findings_are_mapped_from_token_numbers(service, fake_llm):
    body = "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"
    pre = preprocess(body)
    idx = next(t.index for t in pre.tokens if t.surface == "寂しく")
    fake_llm.responder = llm_returning([[
        {"code": "B1", "tokenStart": idx, "tokenEnd": idx, "confidence": 0.9, "reason": "感情を直接言っています"},
        {"code": "D2", "tokenStart": None, "tokenEnd": None, "confidence": 0.4, "reason": "結句がまとめになっています"},
        {"code": "ZZ", "tokenStart": None, "tokenEnd": None, "confidence": 0.9, "reason": "不明なコード"},
        {"code": "B2", "tokenStart": 999, "tokenEnd": 999, "confidence": 0.9, "reason": "範囲外"},
        {"code": "A1", "tokenStart": 0, "tokenEnd": 0, "confidence": 0.9, "reason": "ルールのコード"},
    ]])
    t = service.create_tanka(USER, None)
    res = save(service, t.id, body)
    run = [r for r in service.repo.list_check_runs(t.id, res.revision.id) if r.phase == "async"][0]
    by_code = {f.code: f for f in run.findings}
    assert set(by_code) == {"B1", "D2"}  # 外れた指摘は捨てる
    b1 = by_code["B1"]
    assert b1.matchedText == "寂しく" and b1.segmentNo == 3
    assert b1.fingerprint == "B1:寂しい"  # 原形から作る
    assert b1.severity == "medium"
    assert by_code["D2"].segmentNo is None and by_code["D2"].fingerprint == "D2"
    assert by_code["D2"].confidence == 0.4  # 保存はする（表示はクライアントで閾値判定）


def test_transitions_across_revisions(service, fake_llm):
    t = service.create_tanka(USER, None)
    body1 = "夕暮れの駅のホームの片隅で頬を伝う涙ひとり寂しく"
    body2 = "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"
    idx1 = next(x.index for x in preprocess(body1).tokens if x.surface == "寂しく")
    idx2 = next(x.index for x in preprocess(body2).tokens if x.surface == "寂しく")
    fake_llm.responder = llm_returning([
        [{"code": "B1", "tokenStart": idx1, "tokenEnd": idx1, "confidence": 0.9, "reason": "感情語"},
         {"code": "B2", "tokenStart": 6, "tokenEnd": 8, "confidence": 0.8, "reason": "常套句"}],
        [{"code": "B1", "tokenStart": idx2, "tokenEnd": idx2, "confidence": 0.9, "reason": "感情語"}],
    ])
    r1 = save(service, t.id, body1)
    r2 = save(service, t.id, body2, parent=r1.revision.id)
    assert r2.revision.parentRevisionId == r1.revision.id
    assert "C3:1" in r2.sync_run.resolvedFingerprints
    assert {f.fingerprint: f.transition for f in r2.sync_run.findings} == {"A1:5": "new"}
    run2 = [r for r in service.repo.list_check_runs(t.id, r2.revision.id) if r.phase == "async"][0]
    assert {f.fingerprint: f.transition for f in run2.findings} == {"B1:寂しい": "continued"}
    assert run2.resolvedFingerprints and all(f.startswith("B2:") for f in run2.resolvedFingerprints)
    # 2稿目では E系も判定させ、親の版と前回の指摘を渡す
    second = fake_llm.calls[1]
    assert "E1" in output_schema_codes(second["schema"])
    assert "# 親の版" in second["user"] and "B1" in second["user"]


def test_skips_when_newer_revision_saved(service, fake_llm):
    t = service.create_tanka(USER, None)
    queued = []
    service.enqueuer.handler = queued.append  # 実行を遅らせる
    r1 = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    r2 = save(service, t.id, "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す", parent=r1.revision.id)
    results = [service.run_async_check(p["tankaId"], p["revisionId"], p["runId"]) for p in queued]
    assert [r.status for r in results] == ["skipped", "done"]
    assert len(fake_llm.calls) == 1  # 最後の版だけLLMにかける
    # 飛ばした版の次は、さらに前の版（なし）と比べる
    assert r2.revision.revisionNo == 2


def test_reuses_result_when_text_unchanged(service, fake_llm):
    t = service.create_tanka(USER, None)
    body = "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて"
    r1 = save(service, t.id, body)
    r2 = save(service, t.id, body, parent=r1.revision.id, note="メモだけ変更")
    run2 = [r for r in service.repo.list_check_runs(t.id, r2.revision.id) if r.phase == "async"][0]
    assert run2.reusedFromRunId is not None
    assert len(fake_llm.calls) == 1


def test_daily_limit(service, fake_llm):
    service.settings = service.settings.__class__(**{**service.settings.__dict__, "async_daily_limit": 1})
    t = service.create_tanka(USER, None)
    r1 = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    r2 = save(service, t.id, "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す", parent=r1.revision.id)
    run2 = [r for r in service.repo.list_check_runs(t.id, r2.revision.id) if r.phase == "async"][0]
    assert run2.status == "limited"


def test_llm_failure_marks_run_failed(service, fake_llm):
    def boom(*a):
        raise LLMError("拒否")

    fake_llm.responder = boom
    t = service.create_tanka(USER, None)
    r = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    run = [x for x in service.repo.list_check_runs(t.id, r.revision.id) if x.phase == "async"][0]
    assert run.status == "failed" and run.error == "拒否"


def test_async_run_is_idempotent(service, fake_llm):
    t = service.create_tanka(USER, None)
    r = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    run = [x for x in service.repo.list_check_runs(t.id, r.revision.id) if x.phase == "async"][0]
    again = service.run_async_check(t.id, r.revision.id, run.id)
    assert again.status == "done" and len(fake_llm.calls) == 1


def test_recheck_adds_runs(service):
    t = service.create_tanka(USER, None)
    r = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    service.recheck(USER, t.id, r.revision.id)
    runs = service.repo.list_check_runs(t.id, r.revision.id)
    assert len([x for x in runs if x.phase == "sync"]) == 2
    assert [x.trigger for x in runs if x.phase == "async"] == ["save", "recheck"]


def test_reading_choices_are_remembered(service):
    t = service.create_tanka(USER, None)
    body = "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"
    pre, segs = confirmed(body, readings={4: "きみからのもんじ"})
    service.create_revision(USER, t.id, parent_revision_id=None, body=body, segments=segs, style="colloquial",
                            orthography="modern", note=None, reading_choices={"文字": "もんじ"})
    assert service.repo.get_tanka(t.id).readingMemory == {"文字": "もんじ"}
    again = service.preprocess(USER, t.id, body, style=None, orthography=None, reading_overrides=None)
    assert again.segments[3].reading == "きみからのもんじ"


def test_other_users_cannot_write(service):
    t = service.create_tanka(USER, None)
    with pytest.raises(Forbidden):
        service.preprocess("someone", t.id, "夕暮れの駅のホーム", style=None, orthography=None, reading_overrides=None)


def test_bad_parent(service):
    t = service.create_tanka(USER, None)
    with pytest.raises(BadRequest):
        save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて", parent="nope")


def test_feedback(service):
    t = service.create_tanka(USER, None)
    service.set_feedback(USER, t.id, "A1:5", "intentional", None)
    assert [f.status for f in service.repo.list_feedback(t.id)] == ["intentional"]
    service.delete_feedback(USER, t.id, "A1:5")
    assert service.repo.list_feedback(t.id) == []


def test_output_schema_is_strict():
    s = output_schema(["B1"])
    item = s["properties"]["findings"]["items"]
    assert item["additionalProperties"] is False
    assert set(item["required"]) == {"code", "tokenStart", "tokenEnd", "confidence", "reason"}


def test_fake_llm_records_calls():
    f = FakeLLM()
    assert f.complete_json([], "x", {}) == {"findings": []}
