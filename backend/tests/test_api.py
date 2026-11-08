from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

AUTH = {"Authorization": "Bearer dev:u1"}
OTHER = {"Authorization": "Bearer dev:u2"}


def client(service):
    return TestClient(create_app(Settings(tasks_mode="sync", async_delay_seconds=0), service=service))


def test_full_flow(service):
    c = client(service)
    r = c.post("/tankas", headers=AUTH)
    assert r.status_code == 201
    tid = r.json()["tankaId"]

    body = "夕暮れの 駅のホームで 寂しくて 君からの文字 何度も読み返す"
    pre = c.post(f"/tankas/{tid}/preprocess", json={"body": body}, headers=AUTH)
    assert pre.status_code == 200
    data = pre.json()
    assert [s["mora"] for s in data["segments"]] == [5, 7, 5, 7, 9]
    assert data["totalMora"] == 33
    assert any(c_["surface"] == "文字" for c_ in data["candidates"])

    segs = [{"no": s["no"], "text": s["text"], "reading": s["reading"]} for s in data["segments"]]
    rev = c.post(f"/tankas/{tid}/revisions", json={
        "body": body, "segments": segs, "style": data["style"], "orthography": data["orthography"], "note": "初稿",
    }, headers=AUTH)
    assert rev.status_code == 201, rev.text
    out = rev.json()
    assert out["revisionNo"] == 1
    assert out["asyncRunStatus"] == "queued"
    assert [f["code"] for f in out["syncRun"]["findings"]] == ["A1"]
    f = out["syncRun"]["findings"][0]
    assert f["fingerprint"] == "A1:5" and f["transition"] == "new" and f["span"] == [14 + 6, 27]

    fb = c.put(f"/tankas/{tid}/feedback/A1:5", json={"status": "intentional"}, headers=AUTH)
    assert fb.status_code == 200
    assert c.delete(f"/tankas/{tid}/feedback/A1:5", headers=AUTH).status_code == 204

    re = c.post(f"/tankas/{tid}/revisions/{out['revisionId']}/recheck", headers=AUTH)
    assert re.status_code == 201

    # いまの稿には戻せない
    assert c.post(f"/tankas/{tid}/revisions/{out['revisionId']}/restore", headers=AUTH).status_code == 422


def test_auth_required(service):
    c = client(service)
    assert c.post("/tankas").status_code == 401
    tid = c.post("/tankas", headers=AUTH).json()["tankaId"]
    assert c.post(f"/tankas/{tid}/preprocess", json={"body": "夕暮れの駅"}, headers=OTHER).status_code == 403
    assert c.post("/tankas/none/preprocess", json={"body": "夕暮れの駅"}, headers=AUTH).status_code == 404


def test_validation_errors(service):
    c = client(service)
    tid = c.post("/tankas", headers=AUTH).json()["tankaId"]
    assert c.post(f"/tankas/{tid}/preprocess", json={"body": "あめ"}, headers=AUTH).status_code == 422
    bad = c.post(f"/tankas/{tid}/revisions", json={
        "body": "あいうえおかきくけこ", "segments": [{"no": 1, "text": "あ", "reading": "あ"}],
        "style": "colloquial", "orthography": "modern",
    }, headers=AUTH)
    assert bad.status_code == 422


def test_worker_endpoint(service):
    c = client(service)
    assert c.post("/internal/async-check", json={"tankaId": "x", "revisionId": "y", "runId": "z"}).json() == {"status": "not_found"}


def test_roles(service):
    api_only = TestClient(create_app(Settings(app_role="api"), service=service))
    assert api_only.post("/internal/async-check", json={}).status_code == 404
    worker = TestClient(create_app(Settings(app_role="worker"), service=service))
    assert worker.post("/tankas", headers=AUTH).status_code == 404


def test_refuses_dev_settings_on_cloud_run():
    import pytest

    from app.config import Settings, UnsafeConfiguration, check_production_safety

    with pytest.raises(UnsafeConfiguration):
        check_production_safety(Settings(), {"K_SERVICE": "tanka-api"})
    ok = Settings(
        auth_mode="firebase", repository="firestore", tasks_mode="cloudtasks", firebase_project_id="p",
        worker_url="https://w", tasks_service_account="sa@x",
    )
    check_production_safety(ok, {"K_SERVICE": "tanka-api"})
    check_production_safety(Settings(), {})  # ローカルでは何もしない


def test_refuses_emulator_on_cloud_run():
    import pytest

    from app.config import Settings, UnsafeConfiguration, check_production_safety

    ok = Settings(app_role="api", auth_mode="firebase", repository="firestore", tasks_mode="cloudtasks", firebase_project_id="p")
    with pytest.raises(UnsafeConfiguration, match="FIREBASE_AUTH_EMULATOR_HOST"):
        check_production_safety(ok, {"K_SERVICE": "tanka-api", "FIREBASE_AUTH_EMULATOR_HOST": "localhost:9099"})


def test_requires_worker_auth_settings_on_cloud_run():
    import pytest

    from app.config import Settings, UnsafeConfiguration, check_production_safety

    base = dict(auth_mode="firebase", repository="firestore", tasks_mode="cloudtasks", firebase_project_id="p")
    env = {"K_SERVICE": "tanka-worker"}
    for role in ("worker", "all"):
        with pytest.raises(UnsafeConfiguration, match="WORKER_AUDIENCE"):
            check_production_safety(Settings(app_role=role, tasks_service_account="sa@x", **base), env)
        with pytest.raises(UnsafeConfiguration, match="TASKS_SERVICE_ACCOUNT"):
            check_production_safety(Settings(app_role=role, worker_url="https://w", **base), env)
        check_production_safety(Settings(app_role=role, worker_url="https://w", tasks_service_account="sa@x", **base), env)
    check_production_safety(Settings(app_role="api", **base), env)  # API はワーカーのルートを持たない


def test_worker_rejects_when_auth_not_configured():
    import pytest
    from fastapi import HTTPException

    from app.auth import verify_tasks_caller
    from app.config import Settings

    for s in (
        Settings(auth_mode="firebase", tasks_service_account="sa@x"),
        Settings(auth_mode="firebase", worker_url="https://w"),
    ):
        with pytest.raises(HTTPException) as e:
            verify_tasks_caller("Bearer x", s)
        assert e.value.status_code == 503


def test_health_endpoints(service):
    c = client(service)
    assert c.get("/health").json()["ok"] is True
    assert c.get("/healthz").status_code == 200


def test_input_limits_block_oversized_prompts(service):
    """読みや読みの選択を長大にして、LLMへの入力（費用）を膨らませられないこと。"""
    c = client(service)
    tid = c.post("/tankas", headers=AUTH).json()["tankaId"]
    body = "夕暮れの 駅のホームで 寂しくて 君からの文字 何度も読み返す"
    segs = [{"no": i, "text": t, "reading": "あ"} for i, t in enumerate(body.split(), start=1)]

    def save(**over):
        payload = {"body": body, "segments": segs, "style": "colloquial", "orthography": "modern", **over}
        return c.post(f"/tankas/{tid}/revisions", json=payload, headers=AUTH)

    long_reading = [dict(s, reading="あ" * 500) for s in segs]
    assert save(segments=long_reading).status_code == 422
    assert save(segments=[dict(s, reading="<script>") for s in segs]).status_code == 422
    assert save(segments=segs * 2).status_code == 422
    assert save(body="あ" * 81).status_code == 422
    assert save(readingChoices={"文字": "も" * 21}).status_code == 422
    assert save(readingChoices={f"語{i}": "ご" for i in range(21)}).status_code == 422
    assert c.post(f"/tankas/{tid}/preprocess", json={"body": body, "readingOverrides": {"文字": "x" * 30}}, headers=AUTH).status_code == 422
    assert save(readingChoices={"文字": "もんじ"}).status_code == 201


def test_unreadable_input_returns_message(service):
    c = client(service)
    tid = c.post("/tankas", headers=AUTH).json()["tankaId"]
    r = c.post(f"/tankas/{tid}/preprocess", json={"body": "あ" * 31}, headers=AUTH)
    assert r.status_code == 422
    assert r.json()["detail"].startswith("短歌として読み取れませんでした")
