// 指摘の表示ロジック（画面に依存しない純粋な関数）
import patternsJson from "../generated/patterns.json";
import type { CheckRun, Feedback, Finding, Severity } from "./types";

export interface PatternInfo {
  code: string;
  name: string;
  category: string;
  phase: "sync" | "async";
  severity: Severity;
  severityNote: string | null;
  definition: string;
  criteria: string;
  positive: string[];
  negative: string[];
  requiresParent: boolean;
  /** 根拠（論文・入門書） */
  source: string | null;
}

export const PATTERNS: PatternInfo[] = patternsJson.patterns as PatternInfo[];
export const CATEGORIES: Record<string, string> = patternsJson.categories;
const BY_CODE = new Map(PATTERNS.map((p) => [p.code, p]));

export function patternName(code: string): string {
  const p = BY_CODE.get(code);
  if (!p) return code;
  // 一覧では「字余り・字足らず」だが、指摘では該当した方だけを出す
  return p.name;
}

export function findingTitle(f: Finding): string {
  if (f.code === "A1" && typeof f.evidence.kind === "string") return f.evidence.kind;
  if (f.code === "A4" && typeof f.evidence.kind === "string") return f.evidence.kind;
  return patternName(f.code);
}

export function patternInfo(code: string): PatternInfo | undefined {
  return BY_CODE.get(code);
}

export const SEVERITY_LABEL: Record<Severity, string> = { high: "高", medium: "中", low: "低" };
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export interface DisplayOptions {
  showLow: boolean;
  showLowConfidence: boolean;
  confidenceThreshold: number;
}

export const DEFAULT_DISPLAY: DisplayOptions = { showLow: true, showLowConfidence: false, confidenceThreshold: 0.5 };

export function latestRun(runs: CheckRun[], phase: "sync" | "async"): CheckRun | undefined {
  const list = runs.filter((r) => r.phase === phase);
  return list[list.length - 1];
}

export function latestDoneRun(runs: CheckRun[], phase: "sync" | "async"): CheckRun | undefined {
  const list = runs.filter((r) => r.phase === phase && r.status === "done");
  return list[list.length - 1];
}

export interface RevisionFindings {
  sync?: CheckRun;
  async?: CheckRun;
  /** 画面に出す指摘（重大度順） */
  visible: Finding[];
  /** 作者が「意図的」「誤検出」にした指摘 */
  hidden: { finding: Finding; feedback: Feedback }[];
  /** 表示条件（重大度・確からしさ）で出していない指摘 */
  filtered: Finding[];
  resolved: string[];
  counts: { resolved: number; continued: number; new: number };
  asyncPending: boolean;
  /** 意味のチェックが「実行中」のまま、長く終わっていない（再チェックを出す） */
  asyncStalled: boolean;
}

/** これより長く「実行中」のままなら、止まったものとみなす（通常は30秒ほどで終わる） */
export const STALLED_AFTER_MS = 3 * 60 * 1000;

export function summarize(runs: CheckRun[], feedback: Feedback[], opts: DisplayOptions = DEFAULT_DISPLAY, now: number = Date.now()): RevisionFindings {
  const sync = latestRun(runs, "sync");
  const asyncRun = latestRun(runs, "async");
  const all = [...(sync?.findings ?? []), ...(asyncRun?.status === "done" ? asyncRun.findings : [])];
  const fb = new Map(feedback.map((f) => [f.fingerprint, f]));
  const visible: Finding[] = [];
  const hidden: { finding: Finding; feedback: Feedback }[] = [];
  const filtered: Finding[] = [];
  for (const f of all) {
    const judged = fb.get(f.fingerprint);
    if (judged) hidden.push({ finding: f, feedback: judged });
    else if (!opts.showLow && f.severity === "low") filtered.push(f);
    else if (!opts.showLowConfidence && f.confidence < opts.confidenceThreshold) filtered.push(f);
    else visible.push(f);
  }
  visible.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.segmentNo ?? 9) - (b.segmentNo ?? 9));
  const resolved = [...(sync?.resolvedFingerprints ?? []), ...(asyncRun?.status === "done" ? asyncRun.resolvedFingerprints : [])];
  return {
    sync,
    async: asyncRun,
    visible,
    hidden,
    filtered,
    resolved,
    counts: {
      resolved: resolved.length,
      continued: visible.filter((f) => f.transition === "continued").length,
      new: visible.filter((f) => f.transition === "new").length,
    },
    ...pendingState(asyncRun, now),
  };
}

function pendingState(run: CheckRun | undefined, now: number) {
  const pending = run?.status === "queued" || run?.status === "running";
  const stalled = pending && !!run && now - new Date(run.startedAt).getTime() > STALLED_AFTER_MS;
  return { asyncPending: pending && !stalled, asyncStalled: stalled };
}

export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) c[f.severity] += 1;
  return c;
}

/** 解消した fingerprint を、親の版の指摘から引いて表示用の情報にする。 */
export function resolvedDetails(resolved: string[], parentRuns: CheckRun[]): Finding[] {
  const pool = [...(latestDoneRun(parentRuns, "sync")?.findings ?? []), ...(latestDoneRun(parentRuns, "async")?.findings ?? [])];
  const byFp = new Map(pool.map((f) => [f.fingerprint, f]));
  return resolved.map((fp) => byFp.get(fp)).filter((f): f is Finding => Boolean(f));
}

/** 本文を、指摘の位置で区切った断片にする（強調表示用）。重なる指摘は重大度の高い方を優先する。 */
export function highlightParts(text: string, findings: Finding[]): { text: string; severity: Severity | null }[] {
  const marks: (Severity | null)[] = Array.from({ length: text.length }, () => null);
  for (const f of findings) {
    if (!f.span) continue;
    for (let i = f.span[0]; i < Math.min(f.span[1], text.length); i++) {
      const cur = marks[i];
      if (cur === null || SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[cur]) marks[i] = f.severity;
    }
  }
  const parts: { text: string; severity: Severity | null }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.severity === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], severity: marks[i] });
  }
  return parts;
}

/** 本文を、与えた範囲の内側と外側の断片に分ける（推敲履歴の変更箇所の表示用）。 */
export function markSpans(text: string, spans: [number, number][]): { text: string; marked: boolean }[] {
  const parts: { text: string; marked: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const marked = spans.some(([a, b]) => a <= i && i < b);
    const last = parts[parts.length - 1];
    if (last && last.marked === marked) last.text += text[i];
    else parts.push({ text: text[i], marked });
  }
  return parts;
}

const KANSUJI = "〇一二三四五六七八九";
export function segLabel(no: number): string {
  return `${KANSUJI[no] ?? no}句目`;
}
