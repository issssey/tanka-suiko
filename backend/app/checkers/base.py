"""チェッカーの共通部分。

判定は「ルール」と「LLM」の2種類だけにする。ルールは機械的に数えられるものだけを受け持ち、
その結果を「事実」としてLLMに渡す。意図的かどうかはどちらにも判断させない。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

from ..models import Feedback, Finding, Revision, Token
from ..patterns import Pattern, PatternSet

KANSUJI = "〇一二三四五六七八九"


def seg_label(no: int) -> str:
    return f"{KANSUJI[no]}句目" if 0 < no < len(KANSUJI) else f"{no}句目"


@dataclass
class CheckContext:
    revision: Revision
    patterns: PatternSet
    parent: Revision | None = None
    first: Revision | None = None  # 初稿
    history: list[Revision] = field(default_factory=list)  # 今回より前の版（revisionNo順）
    previous_findings: list[Finding] = field(default_factory=list)  # 親の版の指摘（同期＋非同期）
    rule_results: list[Finding] = field(default_factory=list)  # 今回の版のルールの結果
    parent_rule_results: list[Finding] = field(default_factory=list)  # 親の版のルールの結果
    feedback: dict[str, Feedback] = field(default_factory=dict)


@dataclass
class RawFinding:
    """fingerprint を付ける前の指摘。"""

    code: str
    message: str
    severity: str | None = None  # None ならパターンの既定値
    confidence: float = 1.0
    segmentNo: int | None = None
    span: tuple[int, int] | None = None
    matchedText: str | None = None
    lemma: str | None = None  # 語ベースの fingerprint に使う原形
    evidence: dict = field(default_factory=dict)


class Checker(Protocol):
    codes: list[str]
    phase: Literal["sync", "async"]

    def check(self, ctx: CheckContext) -> list[RawFinding]: ...


def tokens_text(tokens: list[Token], text: str) -> tuple[tuple[int, int], str]:
    start, end = tokens[0].span[0], tokens[-1].span[1]
    return (start, end), text[start:end]


def finalize(raw: list[RawFinding], patterns: PatternSet) -> list[Finding]:
    """fingerprint を付けて Finding にする。

    fingerprint はパターンごとの方式（word / segment / poem）で作る。同じ fingerprint が
    一首に2回以上出る場合は「B1:寂しい#2」のように出現順を付ける。
    """
    counts: dict[str, int] = {}
    findings: list[Finding] = []
    for r in raw:
        p: Pattern = patterns.get(r.code)
        base = _base_fingerprint(p, r)
        counts[base] = counts.get(base, 0) + 1
        fp = base if counts[base] == 1 else f"{base}#{counts[base]}"
        evidence = dict(r.evidence)
        if r.lemma:
            evidence.setdefault("lemma", r.lemma)
        findings.append(
            Finding(
                code=r.code,
                severity=r.severity or p.default_severity(),
                confidence=round(float(r.confidence), 3),
                segmentNo=r.segmentNo,
                span=r.span,
                matchedText=r.matchedText,
                message=r.message,
                evidence=evidence,
                fingerprint=fp,
            )
        )
    return findings


def _base_fingerprint(p: Pattern, r: RawFinding) -> str:
    if p.fingerprint == "word" and r.lemma:
        return f"{p.code}:{r.lemma}"
    if p.fingerprint == "segment" and r.segmentNo is not None:
        return f"{p.code}:{r.segmentNo}"
    return p.code
