"""本物のLLMで、推敲の流れ（第1稿→第2稿→第3稿）を通しで判定させる動作確認。

メモリ上のDBで Service をそのまま動かし、版ごとに即時・非同期の指摘と解消を表示する。

  TANKA_ANTHROPIC_API_KEY=... .venv/bin/python scripts/llm_smoke.py [--model claude-haiku-5-5]

キーは TANKA_ANTHROPIC_API_KEY（なければ ANTHROPIC_API_KEY）から読む。
Claude Code のクラウドセッションでは ANTHROPIC_BASE_URL などがセッション用に設定されているので、
このプロセスの中では外して api.anthropic.com を直接呼ぶ。
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DRAFTS = [
    ("夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて", None),
    ("夕暮れの駅のホームの片隅で頬を伝う涙ひとり寂しく", "結句を感情に寄せてみる"),
    ("夕暮れの 駅のホームで 寂しくて 君からの文字 何度も読み返す", "涙の描写をやめて、行動で見せる"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.environ.get("LLM_MODEL", "claude-haiku-5-5"))
    parser.add_argument("--effort", default=os.environ.get("LLM_EFFORT"))
    args = parser.parse_args()

    key = os.environ.get("TANKA_ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        print("TANKA_ANTHROPIC_API_KEY が設定されていません", file=sys.stderr)
        return 2
    for name in ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"):
        os.environ.pop(name, None)
    os.environ["ANTHROPIC_API_KEY"] = key

    from app.checkers.llm import AnthropicJSONClient, LLMChecker
    from app.config import Settings
    from app.patterns import load_patterns
    from app.preprocess.pipeline import ConfirmedSegment, preprocess
    from app.repository.memory import MemoryRepository
    from app.service import Service
    from app.tasks import SyncEnqueuer

    client = AnthropicJSONClient(model=args.model, provider="anthropic", effort=args.effort)
    calls: list[float] = []
    original = client.complete_json

    def timed(*a, **kw):
        start = time.monotonic()
        try:
            return original(*a, **kw)
        finally:
            calls.append(time.monotonic() - start)

    client.complete_json = timed  # type: ignore[method-assign]

    settings = Settings(tasks_mode="sync", async_delay_seconds=0, llm_provider="anthropic", llm_model=args.model)
    svc = Service(MemoryRepository(), SyncEnqueuer(), LLMChecker(client), settings, load_patterns())
    svc.enqueuer = SyncEnqueuer(lambda p: svc.run_async_check(p["tankaId"], p["revisionId"], p["runId"]))

    user = "smoke"
    tanka = svc.create_tanka(user, "駅のホーム")
    parent = None
    print(f"model={args.model} effort={args.effort or '(既定)'}\n")
    for body, note in DRAFTS:
        pre = preprocess(body)
        segs = [ConfirmedSegment(s.no, s.text, s.reading) for s in pre.segments]
        res = svc.create_revision(user, tanka.id, parent_revision_id=parent, body=body, segments=segs,
                                  style=pre.style, orthography=pre.orthography, note=note)
        parent = res.revision.id
        runs = svc.repo.list_check_runs(tanka.id, res.revision.id)
        async_run = [r for r in runs if r.phase == "async"][-1]
        print(f"=== 第{res.revision.revisionNo}稿：{res.revision.bodyNormalized}")
        print("  句:", " / ".join(f"{s.text}({s.mora})" for s in res.revision.segments))
        for label, run in (("即時", res.sync_run), ("意味", async_run)):
            extra = f" [{run.status}{' ' + run.error if run.error else ''}]" if label == "意味" else ""
            print(f"  [{label}]{extra}")
            for f in run.findings:
                where = f"「{f.matchedText}」" if f.matchedText else "一首全体"
                print(f"    {f.transition:9} {f.severity:6} conf={f.confidence:.2f} {f.fingerprint:14} {where} {f.message}")
            if run.resolvedFingerprints:
                print(f"    解消: {', '.join(run.resolvedFingerprints)}")
        print()
    if calls:
        print(f"LLM呼び出し {len(calls)}回、平均 {sum(calls) / len(calls):.1f}秒、最大 {max(calls):.1f}秒")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
