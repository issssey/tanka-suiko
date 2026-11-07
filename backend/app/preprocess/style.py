"""文体（口語／文語）と仮名遣い（新仮名／旧仮名）の推定。作者が上書きできる。"""

from __future__ import annotations

from dataclasses import dataclass, field

from .kana import is_kana_text, to_katakana
from .tokenizer import RawToken

# 文語らしさの手がかりになる助動詞（原形）
LITERARY_AUX = {"けり", "なり", "たり", "ぬ", "つ", "り", "き", "けむ", "らむ", "べし", "ず", "む", "じ", "まし", "めり", "らし", "ごとし"}
# 口語らしさの手がかりになる助動詞（原形）
COLLOQUIAL_AUX = {"た", "だ", "ます", "です", "ない", "たい", "ようだ", "らしい", "そうだ"}

HISTORICAL_CHARS = set("ゐゑヰヱ")
# 旧仮名で語中・語末のハ行が、読みではア行・ワ行になる対応
_HA_TO_VOWEL = {"ハ": "ワ", "ヒ": "イ", "フ": "ウ", "ヘ": "エ", "ホ": "オ"}


@dataclass
class StyleGuess:
    style: str  # colloquial / literary
    orthography: str  # modern / historical
    literary_markers: list[str] = field(default_factory=list)
    colloquial_markers: list[str] = field(default_factory=list)
    historical_markers: list[str] = field(default_factory=list)


def historical_kana_markers(tokens: list[RawToken]) -> list[str]:
    """旧仮名遣いの印になる表層形を返す。"""
    markers: list[str] = []
    for t in tokens:
        if any(c in HISTORICAL_CHARS for c in t.surface):
            markers.append(t.surface)
            continue
        if t.pos and t.pos[0] == "助詞":
            continue
        if _has_internal_ha_gyo(t):
            markers.append(t.surface)
    return markers


def _has_internal_ha_gyo(t: RawToken) -> bool:
    """語中・語末のハ行表記が、発音ではア行・ワ行になっているか。

    かなの部分を末尾からそろえて比べる（「思ふ」の「ふ」と読みの「ウ」など）。
    Sudachi は旧仮名の読みを表記どおりに返すことがあるので、活用の種類に「ハ行」を
    含む文語動詞の語末のハ行も手がかりにする。
    """
    surface_k = to_katakana(t.surface)
    reading = t.reading
    if len(t.pos) > 4 and "ハ行" in t.pos[4] and surface_k[-1:] in _HA_TO_VOWEL:
        return True
    tail = ""
    for ch in reversed(surface_k):
        if not is_kana_text(ch):
            break
        tail = ch + tail
    if not tail or len(tail) > len(reading):
        return False
    reading_tail = reading[-len(tail):]
    offset = len(surface_k) - len(tail)
    for i, (s, r) in enumerate(zip(tail, reading_tail)):
        if offset + i == 0:
            continue  # 語頭のハ行は旧仮名の印にならない
        if s in _HA_TO_VOWEL and r == _HA_TO_VOWEL[s]:
            return True
    return False


def guess_style(tokens: list[RawToken]) -> StyleGuess:
    lit: list[str] = []
    col: list[str] = []
    for t in tokens:
        pos0 = t.pos[0] if t.pos else ""
        ctype = t.pos[4] if len(t.pos) > 4 else ""
        if ctype.startswith("文語"):
            lit.append(t.surface)
        elif pos0 == "助動詞" and t.lemma in LITERARY_AUX:
            lit.append(t.surface)
        elif pos0 == "助動詞" and t.lemma in COLLOQUIAL_AUX:
            col.append(t.surface)
    hist = historical_kana_markers(tokens)
    style = "literary" if len(lit) > len(col) else "colloquial"
    orth = "historical" if hist else "modern"
    return StyleGuess(style, orth, lit, col, hist)
