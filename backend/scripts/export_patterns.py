"""anti_patterns.yaml から、画面用のパターン一覧（JSON）を書き出す。

  python scripts/export_patterns.py ../frontend/src/generated/patterns.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.patterns import load_patterns  # noqa: E402


def main(out: str) -> None:
    ps = load_patterns()
    data = {
        "version": ps.version,
        "categories": ps.categories,
        "patterns": [
            {
                "code": p.code,
                "name": p.name,
                "category": p.category,
                "phase": p.phase,
                "severity": p.severity if isinstance(p.severity, str) else p.severity.get("excess"),
                "severityNote": "字足らずは高、字余りは中" if isinstance(p.severity, dict) else None,
                "definition": p.definition,
                "requiresParent": p.requires_parent,
            }
            for p in ps.patterns.values()
        ],
    }
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../frontend/src/generated/patterns.json")
