"""本文の正規化。

前後の空白を除き、空白・改行を取り除いた本文（bodyNormalized）を作る。
取り除いた空白・改行の位置は、句の区切りのヒントとして bodyNormalized 上の文字位置で返す。
元の本文は revision.body にそのまま残す。
"""

from __future__ import annotations

from dataclasses import dataclass

_WHITESPACE = set(" \t\r\n　 /／")


@dataclass(frozen=True)
class Normalized:
    text: str
    hints: tuple[int, ...]  # 区切りのヒント（この位置の直前で句が切れる）


def normalize(body: str) -> Normalized:
    stripped = body.strip()
    chars: list[str] = []
    hints: list[int] = []
    pending_break = False
    for ch in stripped:
        if ch in _WHITESPACE:
            pending_break = True
            continue
        if pending_break and chars:
            if not hints or hints[-1] != len(chars):
                hints.append(len(chars))
        pending_break = False
        chars.append(ch)
    return Normalized(text="".join(chars), hints=tuple(hints))
