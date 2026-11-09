"""鑑賞。作者が頼んだ稿について、短歌を読み慣れた読み手がどう読むかを返す（設計書「鑑賞」）。

- 評価・改作案は出さない。指摘ではないので「意図的」「誤検出」も付けない
- 入力はその稿の本文・確定した読みと句分け・文体だけ。指摘の結果・前の稿の鑑賞・作者のメモは入れない
- 語句は形態素の番号で答えさせ、文字位置と文字列はサーバー側で番号から復元する
- 1回の鑑賞につきLLMの呼び出しは1回
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .checkers.base import seg_label
from .checkers.llm import LLMClient, LLMError, _style_label
from .models import AppreciationPause, AppreciationSplit, Revision

PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "appreciation.yaml"

MAX_ITEMS = 3  # 立ち止まった箇所・割れそうな箇所は、それぞれ3つまで
MAX_READINGS = 3
MAX_USER_PROMPT_CHARS = 4000


@lru_cache(maxsize=1)
def load_prompt() -> dict[str, str]:
    with open(PROMPT_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def prompt_version() -> str:
    p = load_prompt()
    digest = hashlib.sha256(json.dumps(p, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return f"{p['version']}+{digest[:8]}"


def output_schema() -> dict[str, Any]:
    phrase = {"tokenStart": {"type": "integer"}, "tokenEnd": {"type": "integer"}}
    return {
        "type": "object",
        "properties": {
            "scene": {"type": "string"},
            "feeling": {"type": "string"},
            "pauses": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {**phrase, "reason": {"type": "string"}},
                    "required": ["tokenStart", "tokenEnd", "reason"],
                    "additionalProperties": False,
                },
            },
            "splits": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {**phrase, "readings": {"type": "array", "items": {"type": "string"}}},
                    "required": ["tokenStart", "tokenEnd", "readings"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["scene", "feeling", "pauses", "splits"],
        "additionalProperties": False,
    }


def build_user_prompt(rev: Revision) -> str:
    lines = ["# 一首", f"本文: {rev.bodyNormalized}", f"文体: {_style_label(rev)}", "", "## 五句"]
    for s in rev.segments:
        lines.append(f"{seg_label(s.no)}: {s.text}（{s.reading}）")
    lines += ["", "## 形態素（番号, 表層形, 読み, 何句目）"]
    for t in rev.tokens:
        lines.append(f"{t.index}\t{t.surface}\t{t.reading}\t{t.segmentNo or '-'}")
    lines += ["", load_prompt()["instructions"].strip()]
    return "\n".join(lines)


def _phrase(rev: Revision, item: dict) -> tuple[int, int, tuple[int, int], str] | None:
    start, end = item.get("tokenStart"), item.get("tokenEnd")
    n = len(rev.tokens)
    if not (isinstance(start, int) and isinstance(end, int)) or not (0 <= start <= end < n):
        return None
    span = (rev.tokens[start].span[0], rev.tokens[end].span[1])
    return start, end, span, rev.bodyNormalized[span[0] : span[1]]


def validate_output(data: Any, rev: Revision) -> dict[str, Any]:
    """出力を確かめ、語句の文字位置と文字列を番号から復元する。番号が外れた項目は捨てる。"""
    if not isinstance(data, dict):
        raise LLMError("鑑賞の応答がJSONの形になっていません")
    scene = str(data.get("scene") or "").strip()
    feeling = str(data.get("feeling") or "").strip()
    if not scene or not feeling:
        raise LLMError("鑑賞の応答に場面か気持ちがありません")
    pauses: list[AppreciationPause] = []
    for item in data.get("pauses") or []:
        if not isinstance(item, dict) or len(pauses) >= MAX_ITEMS:
            continue
        p = _phrase(rev, item)
        reason = str(item.get("reason") or "").strip()
        if p and reason:
            pauses.append(AppreciationPause(tokenStart=p[0], tokenEnd=p[1], span=p[2], text=p[3], reason=reason))
    splits: list[AppreciationSplit] = []
    for item in data.get("splits") or []:
        if not isinstance(item, dict) or len(splits) >= MAX_ITEMS:
            continue
        p = _phrase(rev, item)
        readings = [str(r).strip() for r in item.get("readings") or [] if str(r).strip()][:MAX_READINGS]
        if p and len(readings) >= 2:
            splits.append(AppreciationSplit(tokenStart=p[0], tokenEnd=p[1], span=p[2], text=p[3], readings=readings))
    return {"scene": scene, "feeling": feeling, "pauses": pauses, "splits": splits}


def appreciate(client: LLMClient, rev: Revision) -> dict[str, Any]:
    system = [{"type": "text", "text": load_prompt()["system"].strip()}]
    user = build_user_prompt(rev)
    if len(user) > MAX_USER_PROMPT_CHARS:
        raise LLMError(f"入力が長すぎるため鑑賞しませんでした（{len(user)}字）")
    return validate_output(client.complete_json(system, user, output_schema()), rev)
