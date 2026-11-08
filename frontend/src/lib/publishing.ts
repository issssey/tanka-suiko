// 連作と発表記録の表示用の小物
import type { Publication, Sequence, Tanka } from "./types";

const DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1〜100 を漢数字にする（連作の歌の番号）。 */
export function kanjiNumber(n: number): string {
  if (n >= 100) return "百";
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 0 ? "" : tens === 1 ? "十" : `${DIGITS[tens]}十`}${DIGITS[ones]}`;
}

/** 今日の日付（その端末の暦）を YYYY-MM-DD で返す。 */
export function todayISO(now = new Date()): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 2026-11-07 → 2026年11月7日（long）／11月7日（short。今年なら年を省く） */
export function formatDay(iso: string, style: "long" | "short" = "long", now = new Date()): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  if (style === "short" && y === now.getFullYear()) return `${m}月${d}日`;
  return `${y}年${m}月${d}日`;
}

/** 発表記録が何を出したかの一言（「1首 · 第3稿」「連作「冬のはじまり」8首」）。 */
export function publicationSummary(pub: Publication): string {
  if (pub.sequenceId) return `連作「${pub.sequenceTitle || "無題"}」${pub.items.length}首`;
  if (pub.items.length === 1) return `1首 · 第${pub.items[0].revisionNo}稿`;
  return `${pub.items.length}首`;
}

/** その短歌について、記録の中で出した稿の番号。 */
export function publishedRevisionNo(pub: Publication, tankaId: string): number | undefined {
  return pub.items.find((i) => i.tankaId === tankaId)?.revisionNo;
}

/** 連作の中で、入れた稿といまの稿が違う歌の数。 */
export function staleCount(seq: Sequence, tankasById: Map<string, Tanka>): number {
  return seq.items.filter((i) => {
    const t = tankasById.get(i.tankaId);
    return t?.currentRevisionId && t.currentRevisionId !== i.revisionId;
  }).length;
}

export function sequenceTitle(seq: Pick<Sequence, "title">): string {
  return seq.title.trim() || "無題の連作";
}

/** 本文の冒頭（警告で、どの歌かを示す）。 */
export function snippet(body: string, length = 8): string {
  return body.length > length ? `${body.slice(0, length)}…` : body;
}

/**
 * 連作を出すときの二重投稿の警告の文（1件ごと）。
 * 同じ連作を前に出していれば連作として、そうでなければ当たった歌の冒頭を示す。
 */
export function sequenceDuplicateLine(pub: Publication, seq: Pick<Sequence, "id" | "items">): string {
  const when = `${formatDay(pub.submittedOn, "short")}に「${pub.destination}」に出しています。`;
  if (pub.sequenceId === seq.id) return `この連作は${when}`;
  const ids = new Set(seq.items.map((i) => i.tankaId));
  const hits = pub.items.filter((i) => ids.has(i.tankaId)).map((i) => `「${snippet(i.body)}」`);
  return `${hits.join("")}は${when}`;
}

/** 二重投稿の警告の文（1件ごと）。 */
export function duplicateLine(pub: Publication, tankaId: string | null): string {
  const no = tankaId ? publishedRevisionNo(pub, tankaId) : undefined;
  const what = no ? `第${no}稿` : pub.sequenceId ? `連作「${pub.sequenceTitle || "無題"}」` : "この歌";
  return `${formatDay(pub.submittedOn, "short")}に「${pub.destination}」に${what}を出しています。`;
}

/**
 * 連作を出した記録について、出した後にいまの連作が変わったか（題・歌・並び・稿）。
 * 画面側で計算し、保存はしない（設計書「詳細ページの構造」）。
 */
export function publicationChanged(pub: Publication, seq: Pick<Sequence, "title" | "items">): boolean {
  if ((pub.sequenceTitle ?? "") !== seq.title) return true;
  if (pub.items.length !== seq.items.length) return true;
  return pub.items.some((it, i) => it.tankaId !== seq.items[i].tankaId || it.revisionId !== seq.items[i].revisionId);
}
