import { describe, expect, it } from "vitest";
import { todayInTokyo } from "../lib/data";
import { firstSentence } from "./appreciation";

describe("鑑賞", () => {
  it("チェック結果の欄には浮かんだ場面の最初の1文", () => {
    expect(firstSentence("夕方の駅のホーム。ひとりで立っている。")).toBe("夕方の駅のホーム。");
    expect(firstSentence("場面ははっきり浮かびませんでした。")).toBe("場面ははっきり浮かびませんでした。");
    expect(firstSentence("句点なし")).toBe("句点なし");
    expect(firstSentence(null)).toBe("");
  });
  it("1日の回数は日本時間の日付で数える", () => {
    expect(todayInTokyo(new Date("2026-11-09T15:30:00Z"))).toBe("2026-11-10");
    expect(todayInTokyo(new Date("2026-11-09T14:59:00Z"))).toBe("2026-11-09");
  });
});
