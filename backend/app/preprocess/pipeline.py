"""前処理のパイプライン。

本文を「五句それぞれの読みとモーラ数」に分け、作者が確定できる形で返す（保存前に実行）。
作者が確定した五句から推敲版（revision）を組み立てる処理もここに置く。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models import EXPECTED_MORA, Segment, Token
from .kana import count_morae, is_kana, to_hiragana, to_katakana
from .normalize import normalize
from .readable import unreadable_reason
from .segment import SegmentationError, SegToken, segment
from .style import guess_style
from .tokenizer import RawToken, colloquial_tokenizer, tokenizer_for


class PreprocessError(ValueError):
    pass


class UnreadableError(PreprocessError):
    """短歌として読み取れない入力（チェックをしない）。"""

    def __init__(self, reason: str) -> None:
        super().__init__(f"短歌として読み取れませんでした（{reason}）")
        self.reason = reason


def _check_readable(text: str, spanned) -> None:
    reason = unreadable_reason(text, [t for t, _ in spanned])
    if reason:
        raise UnreadableError(reason)


@dataclass
class ReadingCandidate:
    tokenIndex: int
    surface: str
    readings: list[str]  # ひらがな
    selected: str


@dataclass
class UnknownWord:
    tokenIndex: int
    surface: str
    reading: str  # 推定できた読み（空のことがある）


@dataclass
class PreprocessResult:
    bodyNormalized: str
    hints: list[int]
    style: str
    orthography: str
    detectedStyle: str
    detectedOrthography: str
    tokenizer: str
    tokens: list[Token]
    segments: list[Segment]
    candidates: list[ReadingCandidate] = field(default_factory=list)
    unknownWords: list[UnknownWord] = field(default_factory=list)

    @property
    def totalMora(self) -> int:
        return sum(s.mora for s in self.segments)


def _apply_overrides(raw: list[RawToken], overrides: dict[str, str]) -> list[RawToken]:
    """確定済みの読み（readingMemory と今回の選択）を表層形ごとに当てる。"""
    if not overrides:
        return raw
    out = []
    for t in raw:
        r = overrides.get(t.surface)
        if r:
            out.append(RawToken(t.surface, t.lemma, t.pos, to_katakana(r), t.oov))
        else:
            out.append(t)
    return out


def _with_spans(raw: list[RawToken], text: str) -> list[tuple[RawToken, tuple[int, int]]]:
    out = []
    pos = 0
    for t in raw:
        idx = text.find(t.surface, pos)
        if idx < 0:  # 正規化で表層形が変わった場合など
            idx = pos
        end = idx + len(t.surface)
        out.append((t, (idx, end)))
        pos = end
    return out


MAX_CANDIDATES = 4


def _unvoiced(ch: str) -> str:
    """濁音・半濁音のかなを清音に戻す（連濁形の判定用）。"""
    import unicodedata

    return unicodedata.normalize("NFD", ch)[0]


def _filter_candidates(selected: str, readings: list[str]) -> list[str]:
    """読みの候補を整理する。連濁形（「声」の「ごえ」など）は単独の語では使わないので除く。"""
    out = [selected]
    for r in readings:
        if r in out or not r:
            continue
        if any(r[0] != o[0] and _unvoiced(r[0]) == _unvoiced(o[0]) and r[1:] == o[1:] for o in readings if o != r):
            if _unvoiced(r[0]) != r[0]:
                continue
        out.append(r)
    return out[:MAX_CANDIDATES]


def _needs_reading(t: RawToken) -> bool:
    return any(not is_kana(c) for c in t.reading if c not in "ー") or not t.reading


def tokenize_body(text: str, style: str, overrides: dict[str, str]) -> tuple[str, list[tuple[RawToken, tuple[int, int]]]]:
    tok = tokenizer_for(style)
    raw = _apply_overrides(tok.tokenize(text), overrides)
    return tok.name, _with_spans(raw, text)


def _build_tokens(spanned: list[tuple[RawToken, tuple[int, int]]], segments: list[Segment]) -> list[Token]:
    tokens = []
    for i, (t, span) in enumerate(spanned):
        seg_no = None
        for s in segments:
            if s.span[0] <= span[0] < s.span[1]:
                seg_no = s.no
                break
        tokens.append(
            Token(
                index=i,
                surface=t.surface,
                lemma=t.lemma,
                pos=list(t.pos),
                reading=to_hiragana(t.reading),
                mora=count_morae(t.reading),
                span=span,
                segmentNo=seg_no,
                oov=t.oov,
            )
        )
    return tokens


def preprocess(
    body: str,
    *,
    style: str | None = None,
    orthography: str | None = None,
    reading_memory: dict[str, str] | None = None,
    reading_overrides: dict[str, str] | None = None,
) -> PreprocessResult:
    norm = normalize(body)
    if not norm.text:
        raise PreprocessError("本文が空です")

    # 文体・仮名遣いの推定は口語の辞書で一度解析して行う
    guess = guess_style(colloquial_tokenizer().tokenize(norm.text))
    final_style = style or guess.style
    final_orth = orthography or guess.orthography

    overrides = {**(reading_memory or {}), **(reading_overrides or {})}
    tok = tokenizer_for(final_style)
    tok_name, spanned = tokenize_body(norm.text, final_style, overrides)
    _check_readable(norm.text, spanned)

    try:
        seg_results = segment(
            [SegToken(t.surface, t.reading, span, t.pos[0] if t.pos else "") for t, span in spanned],
            norm.text,
            norm.hints,
        )
    except SegmentationError as e:
        raise PreprocessError(str(e)) from e
    segments = [Segment(**s.__dict__) for s in seg_results]
    tokens = _build_tokens(spanned, segments)

    candidates: list[ReadingCandidate] = []
    unknown: list[UnknownWord] = []
    for token, (raw, _) in zip(tokens, spanned):
        if raw.oov or _needs_reading(raw):
            unknown.append(UnknownWord(token.index, token.surface, token.reading if not _needs_reading(raw) else ""))
            continue
        readings = tok.reading_candidates(raw.surface, raw.pos[0] if raw.pos else "")
        hira = _filter_candidates(token.reading, [to_hiragana(r) for r in readings])
        if len(hira) > 1:
            candidates.append(ReadingCandidate(token.index, token.surface, hira, token.reading))

    return PreprocessResult(
        bodyNormalized=norm.text,
        hints=list(norm.hints),
        style=final_style,
        orthography=final_orth,
        detectedStyle=guess.style,
        detectedOrthography=guess.orthography,
        tokenizer=tok_name,
        tokens=tokens,
        segments=segments,
        candidates=candidates,
        unknownWords=unknown,
    )


@dataclass
class ConfirmedSegment:
    no: int
    text: str
    reading: str


@dataclass
class BuiltRevision:
    body: str
    bodyNormalized: str
    reading: str
    segments: list[Segment]
    tokens: list[Token]


def build_from_confirmed(
    body: str,
    confirmed: list[ConfirmedSegment],
    *,
    style: str,
    reading_memory: dict[str, str] | None = None,
) -> BuiltRevision:
    """作者が確定した五句と読みから、保存する推敲版の中身を組み立てる。"""
    norm = normalize(body)
    if len(confirmed) != len(EXPECTED_MORA):
        raise PreprocessError("句は5つ必要です")
    ordered = sorted(confirmed, key=lambda s: s.no)
    if [s.no for s in ordered] != list(range(1, len(EXPECTED_MORA) + 1)):
        raise PreprocessError("句の番号が正しくありません")
    joined = "".join(normalize(s.text).text for s in ordered)
    if joined != norm.text:
        raise PreprocessError("五句をつなげた文字列が本文と一致しません")

    segments: list[Segment] = []
    pos = 0
    for s in ordered:
        text = normalize(s.text).text
        reading = to_hiragana(s.reading.strip())
        if not reading:
            raise PreprocessError(f"{s.no}句目の読みが空です")
        segments.append(
            Segment(
                no=s.no,
                text=text,
                reading=reading,
                mora=count_morae(reading),
                expected=EXPECTED_MORA[s.no - 1],
                span=(pos, pos + len(text)),
            )
        )
        pos += len(text)

    _, spanned = tokenize_body(norm.text, style, reading_memory or {})
    _check_readable(norm.text, spanned)
    tokens = _build_tokens(spanned, segments)
    return BuiltRevision(
        body=body,
        bodyNormalized=norm.text,
        reading="".join(s.reading for s in segments),
        segments=segments,
        tokens=tokens,
    )
