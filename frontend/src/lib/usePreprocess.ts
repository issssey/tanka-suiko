// 読みと句分けの取得（前処理）と、確定した読みでの保存。スマホの確認画面とPCの書く画面で使う。
import { useEffect, useState } from "react";
import { preprocess, saveRevision } from "./api";
import { countMorae, toHiragana } from "./mora";
import type { Orthography, PreprocessResponse, Style } from "./types";

export interface ReadingState {
  result: PreprocessResponse | null;
  error: string | null;
  loading: boolean;
  style: Style | undefined;
  orthography: Orthography | undefined;
  overrides: Record<string, string>;
  setStyle: (s: Style) => void;
  setOrthography: (o: Orthography) => void;
  choose: (surface: string, reading: string) => void;
  readingOf: (no: number, text: string, fallback: string) => string;
  setManualReading: (no: number, text: string, reading: string) => void;
  totalMora: number;
}

/**
 * 本文から読みと句分けを取る。debounceMs を指定すると、入力が止まってから取りに行く（PCの同時表示用）。
 * 作者が手で直した読みは、句の本文が変わらない限り残す。
 */
export function usePreprocess(
  tankaId: string | null,
  body: string,
  initial: { style?: Style; orthography?: Orthography } = {},
  debounceMs = 0,
): ReadingState {
  const [style, setStyle] = useState<Style | undefined>(initial.style);
  const [orthography, setOrthography] = useState<Orthography | undefined>(initial.orthography);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PreprocessResponse | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tankaId || !body.trim()) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      preprocess(tankaId, body, { style, orthography, readingOverrides: overrides })
        .then((r) => {
          if (cancelled) return;
          setResult(r);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "読みを取得できませんでした"))
        .finally(() => !cancelled && setLoading(false));
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tankaId, body, style, orthography, overrides, debounceMs]);

  const key = (no: number, text: string) => `${no}:${text}`;
  const readingOf = (no: number, text: string, fallback: string) => manual[key(no, text)] ?? fallback;
  const totalMora = result ? result.segments.reduce((n, s) => n + countMorae(readingOf(s.no, s.text, s.reading)), 0) : 0;

  return {
    result,
    error,
    loading,
    style,
    orthography,
    overrides,
    setStyle,
    setOrthography,
    choose: (surface, reading) => setOverrides((o) => ({ ...o, [surface]: reading })),
    readingOf,
    setManualReading: (no, text, reading) => setManual((m) => ({ ...m, [key(no, text)]: reading })),
    totalMora,
  };
}

export async function saveWithReadings(
  tankaId: string,
  state: ReadingState,
  draft: { parentRevisionId: string | null; body: string; note: string },
) {
  const r = state.result;
  if (!r) throw new Error("読みがまだ取得できていません");
  return saveRevision(tankaId, {
    parentRevisionId: draft.parentRevisionId,
    body: draft.body,
    segments: r.segments.map((s) => ({ no: s.no, text: s.text, reading: toHiragana(state.readingOf(s.no, s.text, s.reading)) })),
    style: r.style,
    orthography: r.orthography,
    note: draft.note || null,
    readingChoices: state.overrides,
  });
}
