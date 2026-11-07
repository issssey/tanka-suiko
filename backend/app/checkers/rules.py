"""同期ルール（A1, A4, B7, C2, C3, C5）と履歴ルール（E3）。

形態素と五句の情報に対する条件式だけで判定する。辞書は持たない
（C5の一人称代名詞など、少数の語のリストは anti_patterns.yaml の params に置く）。
"""

from __future__ import annotations

from ..models import Revision, Token
from ..preprocess.kana import to_katakana
from ..preprocess.style import historical_kana_markers
from ..preprocess.tokenizer import RawToken
from .base import CheckContext, RawFinding, seg_label, tokens_text

_SENTENCE_END_FORMS = ("終止形", "命令形")
_PREDICATE_POS = {"動詞", "形容詞", "助動詞"}
_ATTACHING_POS = {"助詞", "助動詞", "補助記号", "接尾辞"}


def _pos(t: Token, i: int) -> str:
    return t.pos[i] if len(t.pos) > i else ""


def _seg_tokens(rev: Revision, no: int) -> list[Token]:
    return [t for t in rev.tokens if t.segmentNo == no]


class MoraRule:
    """A1 字余り・字足らず。確定した読みのモーラ数を句ごとに定型と比べる。"""

    codes = ["A1"]
    phase = "sync"

    def check(self, ctx: CheckContext) -> list[RawFinding]:
        p = ctx.patterns.get("A1")
        out = []
        for s in ctx.revision.segments:
            diff = s.mora - s.expected
            if diff == 0:
                continue
            kind = "excess" if diff > 0 else "shortage"
            word = "字余り" if diff > 0 else "字足らず"
            out.append(
                RawFinding(
                    code="A1",
                    severity=p.severity[kind] if isinstance(p.severity, dict) else None,
                    segmentNo=s.no,
                    span=s.span,
                    matchedText=s.text,
                    message=f"{seg_label(s.no)}「{s.text}」が{s.mora}モーラあります（定型は{s.expected}）。",
                    evidence={"kind": word, "mora": s.mora, "expected": s.expected},
                )
            )
        return out


class KumatagariRule:
    """A4 句またがり・句割れ。"""

    codes = ["A4"]
    phase = "sync"

    def check(self, ctx: CheckContext) -> list[RawFinding]:
        rev = ctx.revision
        text = rev.bodyNormalized
        out: list[RawFinding] = []
        segs = rev.segments
        # 句またがり：一語が句の境界をまたぐ
        for a, b in zip(segs, segs[1:]):
            boundary = a.span[1]
            for t in rev.tokens:
                if t.span[0] < boundary < t.span[1]:
                    out.append(
                        RawFinding(
                            code="A4",
                            segmentNo=a.no,
                            span=t.span,
                            matchedText=t.surface,
                            message=(
                                f"{seg_label(a.no)}から{seg_label(b.no)}へ"
                                f"「{text[t.span[0]:boundary]}／{text[boundary:t.span[1]]}」がまたがっています。"
                            ),
                            evidence={"kind": "句またがり", "lemma": t.lemma},
                        )
                    )
        # 句割れ：句の途中で文が切れている
        for s in segs:
            toks = [t for t in rev.tokens if s.span[0] <= t.span[0] and t.span[1] <= s.span[1]]
            for t, nxt in zip(toks, toks[1:]):
                if self._is_sentence_end(t, nxt):
                    cut = t.span[1]
                    out.append(
                        RawFinding(
                            code="A4",
                            segmentNo=s.no,
                            span=s.span,
                            matchedText=s.text,
                            message=f"{seg_label(s.no)}の途中「{text[s.span[0]:cut]}／{text[cut:s.span[1]]}」で文が切れています。",
                            evidence={"kind": "句割れ"},
                        )
                    )
                    break
        return out

    @staticmethod
    def _is_sentence_end(t: Token, nxt: Token) -> bool:
        if _pos(t, 0) == "補助記号" and _pos(t, 1) == "句点":
            return True
        if _pos(nxt, 0) in _ATTACHING_POS:
            return False
        if _pos(t, 0) == "助詞" and _pos(t, 1) == "終助詞":
            return True
        return _pos(t, 0) in _PREDICATE_POS and _pos(t, 5).startswith(_SENTENCE_END_FORMS)


class SymbolRule:
    """B7 記号の多用。"""

    codes = ["B7"]
    phase = "sync"

    def check(self, ctx: CheckContext) -> list[RawFinding]:
        p = ctx.patterns.get("B7")
        min_symbols = int(p.params.get("minSymbols", 2))
        rev = ctx.revision
        symbols = [t for t in rev.tokens if _pos(t, 0) == "補助記号" and _pos(t, 1) != "空白"]
        if len(symbols) < min_symbols:
            return []
        out = []
        for s in rev.segments:
            in_seg = [t for t in symbols if t.segmentNo == s.no]
            if not in_seg:
                continue
            marks = "".join(t.surface for t in in_seg)
            out.append(
                RawFinding(
                    code="B7",
                    segmentNo=s.no,
                    span=s.span,
                    matchedText=s.text,
                    message=f"{seg_label(s.no)}に記号「{marks}」があります（一首で{len(symbols)}つ）。",
                    evidence={"symbols": marks, "total": len(symbols)},
                )
            )
        return out


class KanaMixRule:
    """C2 旧仮名と新仮名の混在。"""

    codes = ["C2"]
    phase = "sync"

    def check(self, ctx: CheckContext) -> list[RawFinding]:
        rev = ctx.revision
        raw = [RawToken(t.surface, t.lemma, tuple(t.pos), to_katakana(t.reading), t.oov) for t in rev.tokens]
        historical = historical_kana_markers(raw)
        modern = [t.surface for t in rev.tokens if self._is_modern_marker(t)]
        if not historical or not modern:
            return []
        return [
            RawFinding(
                code="C2",
                message=f"旧仮名（{'・'.join(dict.fromkeys(historical))}）と新仮名（{'・'.join(dict.fromkeys(modern))}）が混在しています。",
                evidence={"historical": historical, "modern": modern},
            )
        ]

    @staticmethod
    def _is_modern_marker(t: Token) -> bool:
        """旧仮名ならハ行で書く箇所を、ア行・ワ行で書いているか（ワ行五段の活用語尾）。"""
        ctype = _pos(t, 4)
        if "ワア行" not in ctype or ctype.startswith("文語"):
            return False
        return t.surface[-1:] in "わいうえお"


class ParticleRule:
    """C3 「の」の連続・同じ助詞の反復。"""

    codes = ["C3"]
    phase = "sync"

    def check(self, ctx: CheckContext) -> list[RawFinding]:
        p = ctx.patterns.get("C3")
        chain_min = int(p.params.get("noChainMin", 3))
        max_gap = int(p.params.get("noChainMaxGap", 3))
        same_min = int(p.params.get("sameParticleMin", 3))
        rev = ctx.revision
        text = rev.bodyNormalized
        toks = rev.tokens
        out: list[RawFinding] = []

        no_idx = [t.index for t in toks if t.surface == "の" and _pos(t, 0) == "助詞"]
        runs: list[list[int]] = []
        for i in no_idx:
            if runs and i - runs[-1][-1] - 1 <= max_gap:
                runs[-1].append(i)
            else:
                runs.append([i])
        for run in runs:
            if len(run) < chain_min:
                continue
            start_tok = max(run[0] - 1, 0)
            span, matched = tokens_text(toks[start_tok : run[-1] + 1], text)
            out.append(
                RawFinding(
                    code="C3",
                    segmentNo=toks[run[0]].segmentNo,
                    span=span,
                    matchedText=matched,
                    message=f"「の」が{len(run)}つ続いています（{matched}）。",
                    evidence={"kind": "の", "count": len(run)},
                )
            )

        counts: dict[str, list[Token]] = {}
        for t in toks:
            if _pos(t, 0) == "助詞" and _pos(t, 1) in ("格助詞", "係助詞", "副助詞") and t.surface != "の":
                counts.setdefault(t.surface, []).append(t)
        for surface, occ in counts.items():
            if len(occ) >= same_min:
                out.append(
                    RawFinding(
                        code="C3",
                        segmentNo=occ[0].segmentNo,
                        span=occ[0].span,
                        matchedText=surface,
                        message=f"助詞「{surface}」が{len(occ)}回使われています。",
                        evidence={"kind": "同じ助詞", "particle": surface, "count": len(occ)},
                    )
                )
        return out


class FirstPersonRule:
    """C5 不要な一人称主語。一人称の代名詞があれば指摘する（必要かどうかは作者が決める）。"""

    codes = ["C5"]
    phase = "sync"

    def check(self, ctx: CheckContext) -> list[RawFinding]:
        pronouns = set(ctx.patterns.get("C5").params.get("pronouns", []))
        out = []
        for t in ctx.revision.tokens:
            if _pos(t, 0) != "代名詞" and t.surface not in pronouns:
                continue
            if t.surface in pronouns or t.lemma in pronouns:
                out.append(
                    RawFinding(
                        code="C5",
                        segmentNo=t.segmentNo,
                        span=t.span,
                        matchedText=t.surface,
                        lemma=t.lemma,
                        message=f"{seg_label(t.segmentNo or 0)}に一人称「{t.surface}」があります。",
                    )
                )
        return out


class RevertRule:
    """E3 同じ箇所の行ったり来たり（履歴全体のルール。非同期）。"""

    codes = ["E3"]
    phase = "async"

    def check(self, ctx: CheckContext) -> list[RawFinding]:
        parent = ctx.parent
        if parent is None:
            return []
        older = [r for r in ctx.history if r.id != parent.id and r.revisionNo < parent.revisionNo]
        if not older:
            return []
        reverted = []
        for s in ctx.revision.segments:
            parent_seg = next((x for x in parent.segments if x.no == s.no), None)
            if parent_seg is None or parent_seg.text == s.text:
                continue
            for r in older:
                old = next((x for x in r.segments if x.no == s.no), None)
                if old is not None and old.text == s.text:
                    reverted.append((s, r.revisionNo))
                    break
        if not reverted:
            return []
        parts = [f"{seg_label(s.no)}「{s.text}」は第{no}稿" for s, no in reverted]
        first = reverted[0][0]
        return [
            RawFinding(
                code="E3",
                segmentNo=first.no if len(reverted) == 1 else None,
                span=first.span if len(reverted) == 1 else None,
                matchedText=first.text if len(reverted) == 1 else None,
                message="、".join(parts) + "の表現に戻っています。",
                evidence={"segments": [{"no": s.no, "revisionNo": no} for s, no in reverted]},
            )
        ]


SYNC_RULES = [MoraRule(), KumatagariRule(), SymbolRule(), KanaMixRule(), ParticleRule(), FirstPersonRule()]
HISTORY_RULES = [RevertRule()]
