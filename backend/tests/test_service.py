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
    t = service.create_tanka(USER)
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
    t = service.create_tanka(USER)
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
    t = service.create_tanka(USER)
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
    t = service.create_tanka(USER)
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
    t = service.create_tanka(USER)
    body = "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて"
    r1 = save(service, t.id, body)
    r2 = save(service, t.id, body, parent=r1.revision.id, note="メモだけ変更")
    run2 = [r for r in service.repo.list_check_runs(t.id, r2.revision.id) if r.phase == "async"][0]
    assert run2.reusedFromRunId is not None
    assert len(fake_llm.calls) == 1


def test_restore_old_revision(service, fake_llm):
    """「この稿に戻す」：昔の稿と同じ内容の稿をその稿を親にして作り、いまの稿にする。LLMは呼ばない。"""
    t = service.create_tanka(USER)
    body1 = "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて"
    r1 = save(service, t.id, body1, note="初稿")
    r2 = save(service, t.id, "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す", parent=r1.revision.id)
    calls = len(fake_llm.calls)

    res = service.restore_revision(USER, t.id, r1.revision.id)
    rev = res.revision
    assert rev.revisionNo == 3
    assert rev.parentRevisionId == r1.revision.id and rev.restoredFromRevisionId == r1.revision.id
    assert rev.bodyNormalized == r1.revision.bodyNormalized and rev.reading == r1.revision.reading
    assert rev.segments == r1.revision.segments and rev.note is None
    tanka = service.repo.get_tanka(t.id)
    assert tanka.currentRevisionId == rev.id and tanka.latestBody == r1.revision.bodyNormalized
    # 親と同じ内容なので、指摘はすべて継続、解消なし
    assert res.sync_run.resolvedFingerprints == []
    assert all(f.transition == "continued" for f in res.sync_run.findings)
    run = [r for r in service.repo.list_check_runs(t.id, rev.id) if r.phase == "async"][0]
    assert run.status == "done" and run.reusedFromRunId is not None
    assert len(fake_llm.calls) == calls
    assert r2.revision.id != rev.id

    # いまの稿には戻せない・他人の短歌には戻せない・ない稿には戻せない
    with pytest.raises(BadRequest):
        service.restore_revision(USER, t.id, rev.id)
    with pytest.raises(Forbidden):
        service.restore_revision("u2", t.id, r1.revision.id)
    with pytest.raises(BadRequest):
        service.restore_revision(USER, t.id, "missing")


def test_daily_limit(service, fake_llm):
    service.settings = service.settings.__class__(**{**service.settings.__dict__, "async_daily_limit": 1})
    t = service.create_tanka(USER)
    r1 = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    r2 = save(service, t.id, "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す", parent=r1.revision.id)
    run2 = [r for r in service.repo.list_check_runs(t.id, r2.revision.id) if r.phase == "async"][0]
    assert run2.status == "limited"


def test_llm_failure_marks_run_failed(service, fake_llm):
    def boom(*a):
        raise LLMError("拒否")

    fake_llm.responder = boom
    t = service.create_tanka(USER)
    r = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    run = [x for x in service.repo.list_check_runs(t.id, r.revision.id) if x.phase == "async"][0]
    assert run.status == "failed" and run.error == "拒否"


def test_async_run_is_idempotent(service, fake_llm):
    t = service.create_tanka(USER)
    r = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    run = [x for x in service.repo.list_check_runs(t.id, r.revision.id) if x.phase == "async"][0]
    again = service.run_async_check(t.id, r.revision.id, run.id)
    assert again.status == "done" and len(fake_llm.calls) == 1


def test_recheck_adds_runs(service):
    t = service.create_tanka(USER)
    r = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    service.recheck(USER, t.id, r.revision.id)
    runs = service.repo.list_check_runs(t.id, r.revision.id)
    assert len([x for x in runs if x.phase == "sync"]) == 2
    assert [x.trigger for x in runs if x.phase == "async"] == ["save", "recheck"]


def test_reading_choices_are_remembered(service):
    t = service.create_tanka(USER)
    body = "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"
    pre, segs = confirmed(body, readings={4: "きみからのもんじ"})
    service.create_revision(USER, t.id, parent_revision_id=None, body=body, segments=segs, style="colloquial",
                            orthography="modern", note=None, reading_choices={"文字": "もんじ"})
    assert service.repo.get_tanka(t.id).readingMemory == {"文字": "もんじ"}
    again = service.preprocess(USER, t.id, body, style=None, orthography=None, reading_overrides=None)
    assert again.segments[3].reading == "きみからのもんじ"


def test_other_users_cannot_write(service):
    t = service.create_tanka(USER)
    with pytest.raises(Forbidden):
        service.preprocess("someone", t.id, "夕暮れの駅のホーム", style=None, orthography=None, reading_overrides=None)


def test_bad_parent(service):
    t = service.create_tanka(USER)
    with pytest.raises(BadRequest):
        save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて", parent="nope")


def test_feedback(service):
    t = service.create_tanka(USER)
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


def test_server_fallback_only_for_supported_models():
    from app.checkers.llm import supports_server_fallback

    assert supports_server_fallback("claude-opus-5-5")
    assert supports_server_fallback("claude-sonnet-5-5")
    assert not supports_server_fallback("claude-haiku-5-5")


def test_word_fingerprint_is_stable_when_llm_span_changes(service, fake_llm):
    """LLMが選ぶ範囲が版で変わっても（「ひとり寂しく」→「寂しくて」）、同じ指摘として追跡する。"""
    body1 = "夕暮れの駅のホームの片隅で頬を伝う涙ひとり寂しく"
    body2 = "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"
    t1 = preprocess(body1).tokens
    t2 = preprocess(body2).tokens
    s1 = next(x.index for x in t1 if x.surface == "ひとり")
    e1 = next(x.index for x in t1 if x.surface == "寂しく")
    s2 = next(x.index for x in t2 if x.surface == "寂しく")
    namida = next(x.index for x in t1 if x.surface == "涙")
    fake_llm.responder = llm_returning([
        [{"code": "B1", "tokenStart": s1, "tokenEnd": e1, "confidence": 0.85, "reason": "感情語"},
         {"code": "B2", "tokenStart": namida - 3, "tokenEnd": namida, "confidence": 0.9, "reason": "常套句"}],
        [{"code": "B1", "tokenStart": s2, "tokenEnd": s2 + 1, "confidence": 0.9, "reason": "感情語"}],  # 「寂しくて」
    ])
    t = service.create_tanka(USER)
    r1 = save(service, t.id, body1)
    r2 = save(service, t.id, body2, parent=r1.revision.id)
    run1 = [r for r in service.repo.list_check_runs(t.id, r1.revision.id) if r.phase == "async"][0]
    run2 = [r for r in service.repo.list_check_runs(t.id, r2.revision.id) if r.phase == "async"][0]
    assert {f.fingerprint for f in run1.findings} == {"B1:寂しい", "B2:涙"}
    assert {f.fingerprint: f.transition for f in run2.findings} == {"B1:寂しい": "continued"}
    assert run2.resolvedFingerprints == ["B2:涙"]


def test_global_daily_limit(service, fake_llm):
    service.settings = service.settings.__class__(**{**service.settings.__dict__, "async_global_daily_limit": 1})
    t1 = service.create_tanka(USER)
    save(service, t1.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    other = service.create_tanka("u2")
    pre, segs = confirmed("夕暮れの駅のホームで寂しくて君からの文字何度も読み返す")
    r = service.create_revision("u2", other.id, parent_revision_id=None, body=pre.bodyNormalized, segments=segs,
                                style=pre.style, orthography=pre.orthography, note=None)
    run = [x for x in service.repo.list_check_runs(other.id, r.revision.id) if x.phase == "async"][0]
    assert run.status == "limited"  # 別の作者でも、サービス全体の上限で止まる
    assert len(fake_llm.calls) == 1


def test_oversized_prompt_is_not_sent(service, fake_llm, monkeypatch):
    import app.checkers.llm as llm

    monkeypatch.setattr(llm, "MAX_USER_PROMPT_CHARS", 100)
    t = service.create_tanka(USER)
    r = save(service, t.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    run = [x for x in service.repo.list_check_runs(t.id, r.revision.id) if x.phase == "async"][0]
    assert run.status == "failed" and "長すぎる" in run.error
    assert fake_llm.calls == []


# --- 連作と発表 ---
def test_sequence_lifecycle(service):
    t1 = service.create_tanka(USER)
    r1 = save(service, t1.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    t2 = service.create_tanka(USER)
    r2 = save(service, t2.id, "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す")
    seq = service.create_sequence(USER, " 駅の灯 ", [(t1.id, None), (t2.id, None)], None)
    assert seq.title == "駅の灯"
    assert [(i.tankaId, i.revisionId) for i in seq.items] == [(t1.id, r1.revision.id), (t2.id, r2.revision.id)]
    assert service.repo.get_tanka(t1.id).sequenceIds == [seq.id]
    # 推敲しても連作の中身は変わらない
    r1b = save(service, t1.id, "夕暮れの駅のホームの片隅で頬を伝う涙ひとり寂しく", parent=r1.revision.id)
    assert service.repo.get_sequence(seq.id).items[0].revisionId == r1.revision.id
    # 並べ替えと差し替え
    seq = service.update_sequence(USER, seq.id, "駅の灯", [(t2.id, r2.revision.id), (t1.id, r1b.revision.id)], None)
    assert [i.revisionId for i in seq.items] == [r2.revision.id, r1b.revision.id]

    with pytest.raises(BadRequest):
        service.update_sequence(USER, seq.id, "x", [(t1.id, None), (t1.id, None)], None)  # 同じ歌を2回
    with pytest.raises(BadRequest):
        service.update_sequence(USER, seq.id, "x", [(t1.id, "missing")], None)
    with pytest.raises(Forbidden):
        service.update_sequence("u2", seq.id, "x", [], None)
    with pytest.raises(Forbidden):
        service.create_sequence("u2", "x", [(t1.id, None)], None)  # 他人の歌は入れられない

    # 短歌を削除すると連作から外れる
    service.delete_tanka(USER, t1.id)
    assert [i.tankaId for i in service.repo.get_sequence(seq.id).items] == [t2.id]
    service.delete_sequence(USER, seq.id)
    assert service.repo.get_tanka(t2.id).sequenceIds == []


def test_sequence_item_limit(service, monkeypatch):
    import app.service as svc_mod

    monkeypatch.setattr(svc_mod, "MAX_SEQUENCE_ITEMS", 1)
    t1, t2 = service.create_tanka(USER), service.create_tanka(USER)
    save(service, t1.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    save(service, t2.id, "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す")
    with pytest.raises(BadRequest):
        service.create_sequence(USER, "x", [(t1.id, None), (t2.id, None)], None)


def test_publication_lifecycle(service):
    t1 = service.create_tanka(USER)
    r1 = save(service, t1.id, "夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    t2 = service.create_tanka(USER)
    r2 = save(service, t2.id, "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す")

    assert service.check_publications(USER, [t1.id]) == []
    p1 = service.create_publication(USER, destination=" みなと新聞 歌壇 ", submitted_on="2026-11-07", note="結果待ち",
                                    items=[(t1.id, r1.revision.id)])
    assert p1.destination == "みなと新聞 歌壇" and p1.items[0].revisionNo == 1
    assert p1.items[0].body == r1.revision.bodyNormalized and p1.tankaIds == [t1.id]
    assert service.repo.get_tanka(t1.id).publishedCount == 1

    # 連作として出す：その時点の題と中身を写す
    seq = service.create_sequence(USER, "駅の灯", [(t1.id, None), (t2.id, None)], None)
    p2 = service.create_publication(USER, destination="青嶺短歌賞", submitted_on="2026-11-08", note=None,
                                    sequence_id=seq.id)
    assert p2.sequenceTitle == "駅の灯" and [i.revisionId for i in p2.items] == [r1.revision.id, r2.revision.id]
    service.update_sequence(USER, seq.id, "改題", [(t2.id, None)], None)
    assert service.repo.get_publication(p2.id).sequenceTitle == "駅の灯"  # 後で連作を直しても記録は変わらない

    # 二重投稿の確認：稿が違っても同じ短歌なら返す
    r1b = save(service, t1.id, "夕暮れの駅のホームの片隅で頬を伝う涙ひとり寂しく", parent=r1.revision.id)
    assert [p.id for p in service.check_publications(USER, [t1.id])] == [p2.id, p1.id]
    assert service.check_publications("u2", [t1.id]) == []
    # 警告するだけで、記録はできる
    service.create_publication(USER, destination="SNS", submitted_on="2026-11-09", note=None,
                               items=[(t1.id, r1b.revision.id)])
    assert service.repo.get_destinations(USER) == ["SNS", "青嶺短歌賞", "みなと新聞 歌壇"]

    # 直せるのは出し先・日付・フリーテキストだけ
    p1u = service.update_publication(USER, p1.id, destination="みなと新聞 歌壇", submitted_on="2026-11-07", note="入選")
    assert p1u.note == "入選" and p1u.items == p1.items
    with pytest.raises(Forbidden):
        service.update_publication("u2", p1.id, destination="x", submitted_on="2026-11-07", note=None)
    with pytest.raises(BadRequest):
        service.create_publication(USER, destination="x", submitted_on="2026-11-07", note=None, items=[])
    with pytest.raises(Forbidden):
        service.create_publication("u2", destination="x", submitted_on="2026-11-07", note=None,
                                   items=[(t1.id, r1.revision.id)])

    # 短歌を削除しても発表記録は残る
    service.delete_tanka(USER, t1.id)
    assert service.repo.get_publication(p1.id).items[0].body == r1.revision.bodyNormalized
    service.delete_publication(USER, p2.id)
    assert service.repo.get_tanka(t2.id).publishedCount == 0

    export = service.export_user(USER)
    assert len(export["publications"]) == 2 and len(export["sequences"]) == 1
