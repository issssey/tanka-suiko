// 「推敲を書く」→「読みと句分けの確認」へ渡す下書き。リロードしても消えないよう sessionStorage に置く。
import type { Orthography, Style } from "./types";

export interface Draft {
  tankaId: string;
  parentRevisionId: string | null;
  body: string;
  note: string;
  style?: Style;
  orthography?: Orthography;
}

const key = (tankaId: string) => `suiko.draft.${tankaId}`;

export function saveDraft(d: Draft) {
  try {
    sessionStorage.setItem(key(d.tankaId), JSON.stringify(d));
  } catch {
    /* noop */
  }
  memory.set(d.tankaId, d);
}

export function loadDraft(tankaId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key(tankaId));
    if (raw) return JSON.parse(raw) as Draft;
  } catch {
    /* noop */
  }
  return memory.get(tankaId) ?? null;
}

export function clearDraft(tankaId: string) {
  try {
    sessionStorage.removeItem(key(tankaId));
  } catch {
    /* noop */
  }
  memory.delete(tankaId);
}

const memory = new Map<string, Draft>();
