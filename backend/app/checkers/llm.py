"""LLMによる非同期チェック。

ルール以外の全パターンを、保存1回につき1回の呼び出しでまとめて判定する。
該当箇所は形態素の番号で答えさせ、表層の文字列と文字位置はサーバー側で番号から復元する。
出力はスキーマ・番号の範囲・パターンコードで検証し、外れた指摘は捨てる。
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

import yaml

from ..models import Finding, Revision, Token
from ..patterns import Pattern
from .base import CheckContext, RawFinding, seg_label

log = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "llm_check.yaml"


class LLMError(RuntimeError):
    pass


class LLMClient(Protocol):
    """構造化出力でJSONを返すクライアント。"""

    model: str

    def complete_json(self, system: list[dict[str, Any]], user: str, schema: dict[str, Any]) -> dict[str, Any]: ...


@lru_cache(maxsize=1)
def load_prompt() -> dict[str, str]:
    with open(PROMPT_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def prompt_version(patterns_version: str) -> str:
    """プロンプトの版。プロンプトかパターン定義が変われば変わる。"""
    p = load_prompt()
    digest = hashlib.sha256((json.dumps(p, ensure_ascii=False, sort_keys=True) + patterns_version).encode()).hexdigest()
    return f"{p['version']}+{patterns_version}+{digest[:8]}"


def target_patterns(ctx: CheckContext) -> list[Pattern]:
    pats = ctx.patterns.by_method("llm")
    if ctx.parent is None:
        pats = [p for p in pats if not p.requires_parent]
    return pats


def output_schema(codes: list[str]) -> dict[str, Any]:
    nullable_int = {"anyOf": [{"type": "integer"}, {"type": "null"}]}
    return {
        "type": "object",
        "properties": {
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string", "enum": codes},
                        "tokenStart": nullable_int,
                        "tokenEnd": nullable_int,
                        "confidence": {"type": "number"},
                        "reason": {"type": "string"},
                    },
                    "required": ["code", "tokenStart", "tokenEnd", "confidence", "reason"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["findings"],
        "additionalProperties": False,
    }


def _pattern_block(patterns: list[Pattern]) -> str:
    lines = ["# 判定するパターン"]
    for p in patterns:
        lines.append(f"## {p.code} {p.name}")
        lines.append(f"定義: {p.definition}")
        lines.append(f"判定基準: {p.criteria}")
        if p.positive:
            lines.append("該当例: " + " / ".join(p.positive))
        if p.negative:
            lines.append("非該当例: " + " / ".join(p.negative))
    return "\n".join(lines)


def _style_label(rev: Revision) -> str:
    style = "文語" if rev.style == "literary" else "口語"
    orth = "旧仮名" if rev.orthography == "historical" else "新仮名"
    return f"{style}・{orth}"


def _findings_lines(findings: list[Finding]) -> list[str]:
    out = []
    for f in findings:
        where = f"「{f.matchedText}」" if f.matchedText else "一首全体"
        out.append(f"- {f.code} {where}: {f.message}")
    return out or ["- なし"]


def build_user_prompt(ctx: CheckContext) -> str:
    rev = ctx.revision
    lines = ["# 対象の版", f"本文: {rev.bodyNormalized}", f"文体: {_style_label(rev)}", "", "## 五句"]
    for s in rev.segments:
        lines.append(f"{seg_label(s.no)}: {s.text}（{s.reading}、{s.mora}モーラ／定型{s.expected}）")
    lines += ["", "## 形態素（番号, 表層形, 原形, 品詞, 読み, 何句目）"]
    for t in rev.tokens:
        pos = "-".join(x for x in t.pos[:2] if x and x != "*")
        lines.append(f"{t.index}\t{t.surface}\t{t.lemma}\t{pos}\t{t.reading}\t{t.segmentNo or '-'}")
    lines += ["", "## ルールの結果（事実）"]
    lines += [f"- {f.code}: {f.message}" for f in ctx.rule_results] or ["- なし"]

    if ctx.parent is not None:
        lines += ["", "# 親の版", f"本文: {ctx.parent.bodyNormalized}", "## 前回の指摘"]
        lines += _findings_lines(ctx.previous_findings)
        # 音数の変化（A1 字足らず・A5/A6 字余り。切り替え前の版の A1 字余りも含む）
        mora_codes = ("A1", "A5", "A6")
        a1_now = {f.segmentNo: f for f in ctx.rule_results if f.code in mora_codes}
        a1_before = {f.segmentNo: f for f in ctx.parent_rule_results if f.code in mora_codes}
        changes = []
        for no in sorted({*a1_now, *a1_before} - {None}):
            if no in a1_before and no not in a1_now:
                changes.append(f"- {seg_label(no)}: 親の版の音数のずれが今回は解消（{a1_before[no].message}）")
            elif no in a1_now and no not in a1_before:
                changes.append(f"- {seg_label(no)}: 今回、音数のずれが新たに発生（{a1_now[no].message}）")
        lines += ["## A1・A5・A6（音数）の変化"] + (changes or ["- なし"])
    if ctx.first is not None and ctx.first.id != rev.id and (ctx.parent is None or ctx.first.id != ctx.parent.id):
        lines += ["", "# 初稿", f"本文: {ctx.first.bodyNormalized}"]
    elif ctx.first is not None and ctx.parent is not None and ctx.first.id == ctx.parent.id:
        lines += ["", "# 初稿", "親の版が初稿です。"]

    lines += ["", load_prompt()["instructions"].strip()]
    return "\n".join(lines)


@dataclass
class LLMResult:
    findings: list[RawFinding]
    discarded: int


# LLMに送る、歌ごとの部分（本文・読み・形態素・前の稿など）の上限（文字数）。
# API の入力制限で通常は 2,000 字前後に収まる。それを大きく超えるのは不正な入力なので送らない。
MAX_USER_PROMPT_CHARS = 6000


class LLMChecker:
    phase = "async"

    def __init__(self, client: LLMClient) -> None:
        self.client = client

    @property
    def codes(self) -> list[str]:
        return []

    def check(self, ctx: CheckContext) -> LLMResult:
        patterns = target_patterns(ctx)
        if not patterns:
            return LLMResult([], 0)
        codes = [p.code for p in patterns]
        system = [
            {"type": "text", "text": load_prompt()["system"].strip()},
            # パターン定義は版をまたいで変わらないのでキャッシュの対象にする
            {"type": "text", "text": _pattern_block(patterns), "cache_control": {"type": "ephemeral"}},
        ]
        user = build_user_prompt(ctx)
        if len(user) > MAX_USER_PROMPT_CHARS:
            raise LLMError(f"入力が長すぎるため判定しませんでした（{len(user)}字）")
        data = self.client.complete_json(system, user, output_schema(codes))
        return validate_output(data, ctx, set(codes))


# 語ベースの fingerprint の中心にする品詞（自立語）
_CONTENT_POS = {"名詞", "代名詞", "動詞", "形容詞", "形状詞", "副詞", "連体詞", "感動詞"}


def head_lemma(tokens: list[Token]) -> str:
    """範囲の中心になる語（最後の自立語）の原形。

    LLMが選ぶ範囲は版によって伸び縮みする（「ひとり寂しく」と「寂しくて」など）ので、
    範囲全体をつなげると同じ指摘でも fingerprint が変わってしまう。日本語は後ろの語が
    中心になるため、最後の自立語の原形を使う。自立語がなければ範囲全体をつなげる。
    """
    for t in reversed(tokens):
        if t.pos and t.pos[0] in _CONTENT_POS:
            return t.lemma
    return "".join(t.lemma for t in tokens)


def validate_output(data: Any, ctx: CheckContext, allowed: set[str]) -> LLMResult:
    rev = ctx.revision
    n = len(rev.tokens)
    items = data.get("findings") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise LLMError("findings がありません")
    out: list[RawFinding] = []
    discarded = 0
    for item in items:
        try:
            code = item["code"]
            start, end = item.get("tokenStart"), item.get("tokenEnd")
            conf = float(item.get("confidence", 0))
            reason = str(item.get("reason", "")).strip()
        except (KeyError, TypeError, ValueError):
            discarded += 1
            continue
        if code not in allowed or not reason or not (0.0 <= conf <= 1.0):
            discarded += 1
            continue
        if (start is None) != (end is None):
            start = end = start if start is not None else end
        if start is not None:
            if not (isinstance(start, int) and isinstance(end, int)) or not (0 <= start <= end < n):
                discarded += 1
                continue
            toks = rev.tokens[start : end + 1]
            span = (toks[0].span[0], toks[-1].span[1])
            out.append(
                RawFinding(
                    code=code,
                    confidence=conf,
                    segmentNo=toks[0].segmentNo,
                    span=span,
                    matchedText=rev.bodyNormalized[span[0] : span[1]],
                    lemma=head_lemma(toks),
                    message=reason,
                    evidence={"tokenStart": start, "tokenEnd": end},
                )
            )
        else:
            out.append(RawFinding(code=code, confidence=conf, message=reason))
    return LLMResult(out, discarded)


# --- クライアント -----------------------------------------------------------


# サーバー側の fallbacks="default" を受け付けるモデル（Haiku 5.5 などは非対応）
_FALLBACK_MODELS = ("claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5")


def supports_server_fallback(model: str) -> bool:
    return model in _FALLBACK_MODELS


class AnthropicJSONClient:
    """Claude（Anthropic API または Vertex AI）を構造化出力で呼ぶ。

    設計書の「temperature 0」は、現行モデルでは sampling パラメータが受け付けられないため使わない。
    構造化出力（output_config.format）でJSONを受け取り、前回の指摘を渡してばらつきを抑える。
    """

    def __init__(self, model: str, provider: str = "anthropic", effort: str | None = None,
                 vertex_project: str | None = None, vertex_region: str | None = None,
                 max_tokens: int = 8000) -> None:
        import anthropic

        self.model = model
        self.provider = provider
        self.effort = effort
        self.max_tokens = max_tokens
        if provider == "vertex":
            self._client = anthropic.AnthropicVertex(project_id=vertex_project, region=vertex_region or "global")
        else:
            self._client = anthropic.Anthropic()

    def complete_json(self, system: list[dict[str, Any]], user: str, schema: dict[str, Any]) -> dict[str, Any]:
        output_config: dict[str, Any] = {"format": {"type": "json_schema", "schema": schema}}
        if self.effort:
            output_config["effort"] = self.effort
        kwargs: dict[str, Any] = dict(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config=output_config,
        )
        import anthropic

        try:
            if self.provider == "anthropic" and supports_server_fallback(self.model):
                # 安全分類器による拒否のとき、サーバー側で別モデルに切り替えて再実行する
                response = self._client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs
                )
            else:
                response = self._client.messages.create(**kwargs)
        except anthropic.RateLimitError:
            raise  # 再試行で直りうる（Cloud Tasks が再配信する）
        except anthropic.APIStatusError as e:
            if e.status_code >= 500:
                raise
            # 認証・リクエストの誤りは再試行しても直らないので、失敗として記録する
            raise LLMError(f"LLM APIエラー（{e.status_code}）") from e
        if response.stop_reason == "refusal":
            raise LLMError("LLMが判定を拒否しました")
        if response.stop_reason == "max_tokens":
            raise LLMError("LLMの出力が上限に達しました")
        text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), None)
        if text is None:
            raise LLMError("LLMの応答に本文がありません")
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise LLMError("LLMの応答がJSONではありません") from e


class NullLLMClient:
    """LLMを使わない開発用クライアント。チェックは常に指摘なし、鑑賞は内容のない読みを返す。"""

    model = "none"

    def complete_json(self, system, user, schema):  # noqa: D401
        if "scene" in schema.get("properties", {}):
            note = "（LLMを使わない設定のため、鑑賞の内容はありません）"
            return {"scene": note, "feeling": note, "pauses": [], "splits": []}
        return {"findings": []}
