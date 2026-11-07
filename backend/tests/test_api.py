from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

AUTH = {"Authorization": "Bearer dev:u1"}
OTHER = {"Authorization": "Bearer dev:u2"}


def client(service):
    return TestClient(create_app(Settings(tasks_mode="sync", async_delay_seconds=0), service=service))


def test_full_flow(service):
    c = client(service)
    r = c.post("/tankas", json={"title": "駅のホーム"}, headers=AUTH)
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


def test_auth_required(service):
    c = client(service)
    assert c.post("/tankas", json={}).status_code == 401
    tid = c.post("/tankas", json={}, headers=AUTH).json()["tankaId"]
    assert c.post(f"/tankas/{tid}/preprocess", json={"body": "夕暮れの駅"}, headers=OTHER).status_code == 403
    assert c.post("/tankas/none/preprocess", json={"body": "夕暮れの駅"}, headers=AUTH).status_code == 404


def test_validation_errors(service):
    c = client(service)
    tid = c.post("/tankas", json={}, headers=AUTH).json()["tankaId"]
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
    assert worker.post("/tankas", json={}, headers=AUTH).status_code == 404
