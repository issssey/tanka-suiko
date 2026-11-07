"""形態素解析。

口語は SudachiPy（core辞書）、文語は fugashi＋中古和文UniDic（または近代文語UniDic）を使う。
文語用の辞書は PyPI にないため、環境変数 LITERARY_UNIDIC_DIR で辞書のディレクトリを指定する。
指定がない場合は、文語の歌も SudachiPy で解析する（Sudachiも文語の活用をある程度扱える）。
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from .kana import has_kanji, is_kana_text, to_katakana

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class RawToken:
    surface: str
    lemma: str
    pos: tuple[str, ...]
    reading: str  # カタカナの発音形（読み）
    oov: bool = False


class Tokenizer(Protocol):
    name: str

    def tokenize(self, text: str) -> list[RawToken]: ...

    def reading_candidates(self, surface: str, pos0: str) -> list[str]: ...


class SudachiTokenizer:
    name = "sudachi-core"

    def __init__(self) -> None:
        from sudachipy import Dictionary, SplitMode

        self._dict = Dictionary(dict="core")
        self._tok = self._dict.tokenizer() if hasattr(self._dict, "tokenizer") else self._dict.create()
        self._mode = SplitMode.C

    def tokenize(self, text: str) -> list[RawToken]:
        tokens = []
        for m in self._tok.tokenize(text, self._mode):
            surface = m.surface()
            reading = m.reading_form()
            oov = m.is_oov()
            if oov and is_kana_text(surface):
                reading = to_katakana(surface)
            tokens.append(
                RawToken(
                    surface=surface,
                    lemma=m.dictionary_form(),
                    pos=tuple(m.part_of_speech()),
                    reading=reading,
                    oov=oov,
                )
            )
        return tokens

    def reading_candidates(self, surface: str, pos0: str) -> list[str]:
        """同じ表層形の辞書項目から、読みの候補を集める。"""
        if not has_kanji(surface):
            return []
        try:
            entries = self._dict.lookup(surface)
        except Exception:  # pragma: no cover - 古いsudachipy
            return []
        seen: list[str] = []
        for m in entries:
            if m.surface() != surface:
                continue
            if pos0 and m.part_of_speech()[0] != pos0:
                continue
            if m.part_of_speech()[1] == "固有名詞" and pos0 != "名詞":
                continue
            r = m.reading_form()
            if r and r not in seen:
                seen.append(r)
        return seen


class FugashiLiteraryTokenizer:
    """fugashi＋文語UniDic。辞書のディレクトリを LITERARY_UNIDIC_DIR で渡す。"""

    name = "fugashi-unidic-literary"

    def __init__(self, dicdir: str) -> None:
        import fugashi

        self._tagger = fugashi.Tagger(f'-d "{dicdir}"')

    def tokenize(self, text: str) -> list[RawToken]:
        tokens = []
        for w in self._tagger(text):
            f = w.feature
            pos = tuple(
                getattr(f, k, "*") or "*" for k in ("pos1", "pos2", "pos3", "pos4", "cType", "cForm")
            )
            pron = getattr(f, "pron", None) or getattr(f, "kana", None) or ""
            if not pron or pron == "*":
                pron = to_katakana(w.surface) if is_kana_text(w.surface) else w.surface
            lemma = getattr(f, "orthBase", None) or getattr(f, "lemma", None) or w.surface
            tokens.append(
                RawToken(
                    surface=w.surface,
                    lemma=lemma if lemma != "*" else w.surface,
                    pos=pos,
                    reading=pron,
                    oov=bool(getattr(w, "is_unk", False)),
                )
            )
        return tokens

    def reading_candidates(self, surface: str, pos0: str) -> list[str]:
        return []


@lru_cache(maxsize=1)
def colloquial_tokenizer() -> Tokenizer:
    return SudachiTokenizer()


@lru_cache(maxsize=1)
def literary_tokenizer() -> Tokenizer:
    dicdir = os.environ.get("LITERARY_UNIDIC_DIR")
    if dicdir:
        try:
            return FugashiLiteraryTokenizer(dicdir)
        except Exception:  # pragma: no cover - 環境依存
            log.exception("文語UniDicを読み込めませんでした。SudachiPyで代用します")
    return colloquial_tokenizer()


def tokenizer_for(style: str) -> Tokenizer:
    return literary_tokenizer() if style == "literary" else colloquial_tokenizer()
