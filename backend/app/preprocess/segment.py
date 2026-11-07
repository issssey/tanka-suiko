"""句分け。

単語の境界を候補に、五七五七七とのずれが最小になる区切りを動的計画法で求める。
単語の途中で切る区切り（句またがり）はペナルティ付きで許し、空白・改行のヒントがあれば優先する。
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models import EXPECTED_MORA
from .kana import char_morae, split_morae, to_hiragana

# コストの重み
MIDWORD_PENALTY = 3.0  # 単語の途中で切る（句またがり）
DEPENDENT_HEAD_PENALTY = 1.5  # 助詞・助動詞・接尾辞・記号で句が始まる
HINT_MISS_PENALTY = 2.0  # ヒントがあるのにヒント以外で切る
EXACT_HINT_PENALTY = 100.0  # ヒントがちょうど4つあるときにヒント以外で切る
EXCESS_WEIGHT = 1.0
SHORTAGE_WEIGHT = 1.0

_DEPENDENT_POS = {"助詞", "助動詞", "接尾辞", "補助記号"}


@dataclass(frozen=True)
class SegToken:
    surface: str
    reading: str  # カタカナ
    span: tuple[int, int]
    pos0: str


@dataclass(frozen=True)
class SegmentResult:
    no: int
    text: str
    reading: str  # ひらがな
    mora: int
    expected: int
    span: tuple[int, int]


@dataclass(frozen=True)
class _Unit:
    mora: str
    token: int
    index_in_token: int


class SegmentationError(ValueError):
    pass


def segment(tokens: list[SegToken], text: str, hints: tuple[int, ...] = ()) -> list[SegmentResult]:
    units: list[_Unit] = []
    token_morae: list[list[str]] = []
    for ti, t in enumerate(tokens):
        morae = split_morae(t.reading)
        token_morae.append(morae)
        for mi, m in enumerate(morae):
            units.append(_Unit(m, ti, mi))

    n_seg = len(EXPECTED_MORA)
    n = len(units)
    if n < n_seg:
        raise SegmentationError("本文が短すぎて五句に分けられません")

    hint_set = set(hints)
    exact_hints = len(hint_set) == n_seg - 1

    def cut_char_pos(k: int) -> int:
        """units[k] の直前で切ったときの、本文上の文字位置。"""
        u = units[k]
        t = tokens[u.token]
        if u.index_in_token == 0:
            return t.span[0]
        return t.span[0] + _char_offset_for_mora(t, len(token_morae[u.token]), u.index_in_token)

    def cut_cost(k: int) -> float:
        u = units[k]
        cost = 0.0
        if u.index_in_token != 0:
            cost += MIDWORD_PENALTY
        elif tokens[u.token].pos0 in _DEPENDENT_POS:
            cost += DEPENDENT_HEAD_PENALTY
        if hint_set:
            if cut_char_pos(k) not in hint_set:
                cost += EXACT_HINT_PENALTY if exact_hints else HINT_MISS_PENALTY
        return cost

    def seg_cost(length: int, expected: int) -> float:
        diff = length - expected
        return diff * EXCESS_WEIGHT if diff > 0 else -diff * SHORTAGE_WEIGHT

    cut_costs = [0.0] + [cut_cost(k) for k in range(1, n)]
    INF = float("inf")
    # dp[s][k]: 先頭 k 単位を s 句に分けたときの最小コスト（k単位目の直前が s 句目の終わり）
    dp = [[INF] * (n + 1) for _ in range(n_seg + 1)]
    back = [[-1] * (n + 1) for _ in range(n_seg + 1)]
    dp[0][0] = 0.0
    for s in range(1, n_seg + 1):
        expected = EXPECTED_MORA[s - 1]
        for k in range(s, n - (n_seg - s) + 1):
            best, arg = INF, -1
            for j in range(s - 1, k):
                if dp[s - 1][j] == INF:
                    continue
                c = dp[s - 1][j] + seg_cost(k - j, expected)
                if j > 0:
                    c += cut_costs[j]
                if c < best:
                    best, arg = c, j
            dp[s][k] = best
            back[s][k] = arg

    cuts: list[int] = []
    k = n
    for s in range(n_seg, 0, -1):
        j = back[s][k]
        cuts.append(j)
        k = j
    cuts.reverse()  # 各句の開始単位 [0, c1, c2, c3, c4]
    bounds = cuts + [n]

    results: list[SegmentResult] = []
    for s in range(n_seg):
        start_u, end_u = bounds[s], bounds[s + 1]
        start_c = 0 if s == 0 else cut_char_pos(start_u)
        end_c = len(text) if s == n_seg - 1 else cut_char_pos(end_u)
        reading = "".join(u.mora for u in units[start_u:end_u])
        results.append(
            SegmentResult(
                no=s + 1,
                text=text[start_c:end_c],
                reading=to_hiragana(reading),
                mora=end_u - start_u,
                expected=EXPECTED_MORA[s],
                span=(start_c, end_c),
            )
        )
    return results


def _char_offset_for_mora(t: SegToken, total_morae: int, mora_index: int) -> int:
    """単語の途中のモーラ境界を、表層形の文字位置に対応づける。"""
    length = t.span[1] - t.span[0]
    cm = char_morae(t.surface)
    if cm is not None and cm and cm[-1] + 1 == total_morae:
        for i, m in enumerate(cm):
            if m >= mora_index:
                return i
        return length
    # 漢字を含むなどで対応が取れない場合は比例配分（作者が確定画面で直せる）
    offset = round(mora_index * length / max(total_morae, 1))
    return min(max(offset, 1), max(length - 1, 1)) if length > 1 else length
