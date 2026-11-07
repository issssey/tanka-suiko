"""入力の門番：短歌として読み取れるかを、機械的に確かめる。

意味の通らない入力（同じ文字の連続、意味を持つ語がないなど）は、チェックをせずに断る。
指摘が出ないことが「良い歌」と誤解されるのを防ぎ、LLM の無駄な呼び出しもなくす。
オノマトペを多用した歌や前衛的な歌を誤って断らないよう、基準は極端なものだけにする。
"""

from __future__ import annotations

from .kana import has_kanji, is_kana

# 意味を持つ語（自立語）の品詞
CONTENT_POS = {"名詞", "代名詞", "動詞", "形容詞", "形状詞", "副詞", "連体詞"}

MAX_SAME_CHAR_RUN = 6  # 同じ文字がこれより多く続いたら断る（「ああああああ」までは許す）
MIN_DISTINCT_CHARS = 5  # 使われている文字の種類がこれより少なければ断る
MIN_JAPANESE_RATIO = 0.5  # かな・漢字の割合がこれより低ければ断る


def _longest_run(text: str) -> tuple[str, int]:
    best_char, best, run, prev = "", 0, 0, ""
    for ch in text:
        run = run + 1 if ch == prev else 1
        prev = ch
        if run > best:
            best_char, best = ch, run
    return best_char, best


def unreadable_reason(text: str, tokens: list) -> str | None:
    """読み取れない理由を返す。読み取れるなら None。tokens は surface と pos を持つ形態素の列。"""
    if not text:
        return "本文がありません"
    japanese = sum(1 for c in text if is_kana(c) or has_kanji(c))
    if japanese / len(text) < MIN_JAPANESE_RATIO:
        return "かなや漢字がほとんど含まれていません"
    ch, run = _longest_run(text)
    if run > MAX_SAME_CHAR_RUN:
        return f"「{ch}」が{run}字続いています"
    if len(set(text)) < MIN_DISTINCT_CHARS:
        return "使われている文字の種類が少なすぎます"
    if not any(t.pos and t.pos[0] in CONTENT_POS for t in tokens):
        return "意味を持つ語（名詞・動詞・形容詞など）が見つかりません"
    return None
