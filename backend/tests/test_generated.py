import json
from pathlib import Path

from app.patterns import load_patterns

GENERATED = Path(__file__).resolve().parents[2] / "frontend" / "src" / "generated" / "patterns.json"


def test_frontend_patterns_json_is_up_to_date():
    """anti_patterns.yaml を変えたら scripts/export_patterns.py で画面用のJSONも作り直す。"""
    data = json.loads(GENERATED.read_text(encoding="utf-8"))
    ps = load_patterns()
    assert data["version"] == ps.version
    assert [p["code"] for p in data["patterns"]] == list(ps.patterns)
    assert {p["code"]: p["name"] for p in data["patterns"]} == {c: p.name for c, p in ps.patterns.items()}
