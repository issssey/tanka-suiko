import { latestDoneRun } from "./findings";
import type { CheckRun, Finding, Revision } from "./types";

/** この指摘の経過：指定した稿までの各稿で、同じ fingerprint の指摘を探す。 */
export function findingTimeline(
  revisions: Revision[],
  runsByRev: Record<string, CheckRun[]>,
  fingerprint: string,
  uptoRevisionNo: number,
): { no: number; finding: Finding }[] {
  const out: { no: number; finding: Finding }[] = [];
  for (const r of revisions) {
    if (r.revisionNo > uptoRevisionNo) break;
    const runs = runsByRev[r.id] ?? [];
    const pool = [...(latestDoneRun(runs, "sync")?.findings ?? []), ...(latestDoneRun(runs, "async")?.findings ?? [])];
    const f = pool.find((x) => x.fingerprint === fingerprint);
    if (f) out.push({ no: r.revisionNo, finding: f });
  }
  return out;
}

/** 稿の指摘の集合（最新の完了したチェック） */
export function findingsOf(runs: CheckRun[] | undefined): Finding[] {
  if (!runs) return [];
  return [...(latestDoneRun(runs, "sync")?.findings ?? []), ...(latestDoneRun(runs, "async")?.findings ?? [])];
}

/** 2つの稿の指摘を比べて、解消・継続・新規に分ける。 */
export function compareFindings(before: Finding[], after: Finding[]) {
  const beforeFp = new Set(before.map((f) => f.fingerprint));
  const afterFp = new Set(after.map((f) => f.fingerprint));
  return {
    resolved: before.filter((f) => !afterFp.has(f.fingerprint)),
    continued: after.filter((f) => beforeFp.has(f.fingerprint)),
    added: after.filter((f) => !beforeFp.has(f.fingerprint)),
  };
}
