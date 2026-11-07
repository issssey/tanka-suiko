"""アンチパターンのマスタ（anti_patterns.yaml）の読み込み。"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml

PATTERNS_PATH = Path(__file__).with_name("anti_patterns.yaml")

Method = Literal["rule", "rule_history", "llm"]
FingerprintMode = Literal["word", "segment", "poem"]


@dataclass(frozen=True)
class Pattern:
    code: str
    name: str
    method: Method
    phase: Literal["sync", "async"]
    severity: Any  # str または A1 の {shortage, excess}
    fingerprint: FingerprintMode
    definition: str
    criteria: str
    requires_parent: bool = False
    positive: tuple[str, ...] = ()
    negative: tuple[str, ...] = ()
    params: dict[str, Any] = field(default_factory=dict)

    @property
    def category(self) -> str:
        return self.code[0]

    def default_severity(self) -> str:
        if isinstance(self.severity, dict):
            return self.severity.get("excess", "medium")
        return self.severity


@dataclass(frozen=True)
class PatternSet:
    version: str
    categories: dict[str, str]
    patterns: dict[str, Pattern]

    def get(self, code: str) -> Pattern:
        return self.patterns[code]

    def by_method(self, *methods: str) -> list[Pattern]:
        return [p for p in self.patterns.values() if p.method in methods]


def _parse(raw: dict[str, Any]) -> PatternSet:
    patterns: dict[str, Pattern] = {}
    for item in raw["patterns"]:
        p = Pattern(
            code=item["code"],
            name=item["name"],
            method=item["method"],
            phase=item["phase"],
            severity=item["severity"],
            fingerprint=item["fingerprint"],
            definition=item["definition"],
            criteria=item["criteria"],
            requires_parent=bool(item.get("requiresParent", False)),
            positive=tuple(item.get("positive", [])),
            negative=tuple(item.get("negative", [])),
            params=dict(item.get("params", {})),
        )
        if p.code in patterns:
            raise ValueError(f"duplicate pattern code: {p.code}")
        patterns[p.code] = p
    return PatternSet(version=str(raw["version"]), categories=raw["categories"], patterns=patterns)


@lru_cache(maxsize=1)
def load_patterns(path: str | None = None) -> PatternSet:
    with open(path or PATTERNS_PATH, encoding="utf-8") as f:
        return _parse(yaml.safe_load(f))
