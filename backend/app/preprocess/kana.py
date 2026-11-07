"""かなの変換とモーラ計算。

モーラは発音形（読み）から数える。小さい「ゃゅょぁぃぅぇぉゎ」は前の字と合わせて1、
「っ」「ん」「ー」はそれぞれ1。かな以外の文字（記号など）は数えない。
"""

from __future__ import annotations

_KATA_START, _KATA_END = 0x30A1, 0x30F6  # ァ..ヶ
_HIRA_OFFSET = 0x60

# 前の字と合わせて1モーラになる小書き文字（ひらがな・カタカナ両方）
SMALL_KANA = set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ")


def to_hiragana(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if _KATA_START <= code <= 0x30F4:  # ヴ まで
            out.append(chr(code - _HIRA_OFFSET))
        else:
            out.append(ch)
    return "".join(out)


def to_katakana(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if 0x3041 <= code <= 0x3094:
            out.append(chr(code + _HIRA_OFFSET))
        else:
            out.append(ch)
    return "".join(out)


def is_kana(ch: str) -> bool:
    code = ord(ch)
    return 0x3041 <= code <= 0x309F or 0x30A0 <= code <= 0x30FF


def is_kana_text(text: str) -> bool:
    return bool(text) and all(is_kana(c) for c in text)


def has_kanji(text: str) -> bool:
    return any(0x4E00 <= ord(c) <= 0x9FFF or c in "々〆ヶ" for c in text)


def split_morae(reading: str) -> list[str]:
    """読みをモーラ単位に分ける。かな以外の文字は捨てる。"""
    morae: list[str] = []
    for ch in reading:
        if not is_kana(ch) or ch in "・゛゜":
            continue
        if ch in SMALL_KANA and morae:
            morae[-1] += ch
        else:
            morae.append(ch)
    return morae


def count_morae(reading: str) -> int:
    return len(split_morae(reading))


def char_morae(surface: str) -> list[int] | None:
    """かなだけの表層形について、各文字が何モーラ目から始まるかの目安を返す。

    小書き文字は前の字と同じモーラに属する。かな以外を含む場合は None。
    戻り値は各文字が属するモーラの番号（0始まり）。
    """
    if not is_kana_text(surface):
        return None
    result: list[int] = []
    current = -1
    for ch in surface:
        if ch in SMALL_KANA and current >= 0:
            result.append(current)
        else:
            current += 1
            result.append(current)
    return result
