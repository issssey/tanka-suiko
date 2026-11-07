// モーラ計算（backend/app/preprocess/kana.py と同じ規則）
// 小さい「ゃゅょぁぃぅぇぉゎ」は前の字と合わせて1、「っ」「ん」「ー」はそれぞれ1。
const SMALL = new Set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ");

function isKana(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x3041 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff);
}

export function countMorae(reading: string): number {
  let n = 0;
  for (const ch of reading) {
    if (!isKana(ch) || ch === "・" || ch === "゛" || ch === "゜") continue;
    if (SMALL.has(ch) && n > 0) continue;
    n += 1;
  }
  return n;
}

export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヴ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export const EXPECTED = [5, 7, 5, 7, 7];
