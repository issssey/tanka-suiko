"""チェックの実行と、版をまたいだ指摘の追跡（解消／継続／新規）。"""

from __future__ import annotations

from dataclasses import dataclass

from ..models import Finding
from .base import CheckContext, finalize
from .llm import LLMChecker
from .rules import HISTORY_RULES, SYNC_RULES


def apply_transitions(findings: list[Finding], previous: list[Finding] | None) -> list[str]:
    """親の版の指摘と突き合わせて transition を付け、解消した fingerprint を返す。

    previous が None（親がない・親の結果がない）ならすべて new、解消はなし。
    同期フェーズは同期どうし、非同期フェーズは非同期どうしで突き合わせる（呼び出し側で渡し分ける）。
    """
    prev_fps = {f.fingerprint for f in previous or []}
    current_fps = set()
    for f in findings:
        f.transition = "continued" if f.fingerprint in prev_fps else "new"
        current_fps.add(f.fingerprint)
    if previous is None:
        return []
    return sorted(prev_fps - current_fps)


def run_sync(ctx: CheckContext, previous_sync: list[Finding] | None) -> tuple[list[Finding], list[str]]:
    raw = []
    for rule in SYNC_RULES:
        raw.extend(rule.check(ctx))
    findings = finalize(raw, ctx.patterns)
    resolved = apply_transitions(findings, previous_sync)
    return findings, resolved


@dataclass
class AsyncOutcome:
    findings: list[Finding]
    resolved: list[str]
    discarded: int


def run_async(ctx: CheckContext, llm: LLMChecker, previous_async: list[Finding] | None) -> AsyncOutcome:
    raw = []
    for rule in HISTORY_RULES:
        raw.extend(rule.check(ctx))
    result = llm.check(ctx)
    raw.extend(result.findings)
    findings = finalize(raw, ctx.patterns)
    resolved = apply_transitions(findings, previous_async)
    return AsyncOutcome(findings, resolved, result.discarded)
