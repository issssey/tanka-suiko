import { describe, expect, it } from "vitest";
import { highlightParts, markSpans, resolvedDetails, summarize } from "./findings";
import { countMorae } from "./mora";
import type { CheckRun, Feedback, Finding } from "./types";

const f = (over: Partial<Finding>): Finding => ({
  code: "B1", severity: "medium", confidence: 0.9, segmentNo: 3, span: [10, 13], matchedText: "寂しく",
  message: "", evidence: {}, fingerprint: "B1:寂しい", transition: "new", ...over,
});
const run = (over: Partial<CheckRun>): CheckRun => ({
  id: "r", phase: "sync", baseRevisionId: null, status: "done", trigger: "save", findings: [],
  resolvedFingerprints: [], error: null, startedAt: new Date(0), finishedAt: null, ...over,
});

describe("countMorae", () => {
  it("小書き文字は前の字と合わせて1、っ・ん・ーは1", () => {
    expect(countMorae("なんどもよみかえす")).toBe(9);
    expect(countMorae("きょう")).toBe(2);
    expect(countMorae("ほーむ")).toBe(3);
    expect(countMorae("がっこう")).toBe(4);
  });
});

describe("summarize", () => {
  const a1 = f({ code: "A1", severity: "medium", fingerprint: "A1:5", span: [20, 27], segmentNo: 5 });
  const b1 = f({ transition: "continued" });
  const low = f({ code: "C3", severity: "low", fingerprint: "C3:1" });
  const unsure = f({ code: "D2", confidence: 0.3, fingerprint: "D2", span: null, segmentNo: null });
  const runs = [
    run({ findings: [a1, low], resolvedFingerprints: ["C3:9"] }),
    run({ phase: "async", findings: [b1, unsure], resolvedFingerprints: ["B2:頬"] }),
  ];

  it("非同期が終わっていれば両方の指摘を出し、確からしさの低いものは省く", () => {
    const s = summarize(runs, []);
    expect(s.visible.map((x) => x.fingerprint)).toEqual(["B1:寂しい", "A1:5", "C3:1"]);
    expect(s.filtered.map((x) => x.fingerprint)).toEqual(["D2"]);
    expect(s.counts).toEqual({ resolved: 2, continued: 1, new: 2 });
  });

  it("作者の判断がある指摘は折りたたむ", () => {
    const fb: Feedback[] = [{ fingerprint: "A1:5", status: "intentional", comment: null, revisionNo: 3, createdAt: new Date() }];
    const s = summarize(runs, fb);
    expect(s.hidden.map((h) => h.finding.fingerprint)).toEqual(["A1:5"]);
    expect(s.visible.some((x) => x.fingerprint === "A1:5")).toBe(false);
  });

  it("非同期が判定中なら同期の結果だけを出す", () => {
    const pending = [runs[0], run({ phase: "async", status: "running" })];
    const s = summarize(pending, [], undefined, 1000);
    expect(s.asyncPending).toBe(true);
    expect(s.visible.map((x) => x.fingerprint)).toEqual(["A1:5", "C3:1"]);
    expect(s.counts.resolved).toBe(1);
  });

  it("重大度「低」を隠せる", () => {
    const s = summarize(runs, [], { showLow: false, showLowConfidence: true, confidenceThreshold: 0.5 });
    expect(s.visible.map((x) => x.fingerprint)).toEqual(["B1:寂しい", "A1:5", "D2"]);
  });
});

describe("resolvedDetails", () => {
  it("解消した fingerprint を親の版の指摘から引く", () => {
    const parent = [run({ findings: [f({ code: "C3", fingerprint: "C3:1", matchedText: "夕暮れの駅のホームの" })] })];
    expect(resolvedDetails(["C3:1", "X"], parent).map((x) => x.matchedText)).toEqual(["夕暮れの駅のホームの"]);
  });
});

describe("highlightParts", () => {
  it("重なる指摘は重大度の高い方を優先する", () => {
    const parts = highlightParts("あいうえお", [f({ span: [1, 4], severity: "low" }), f({ span: [2, 3], severity: "high" })]);
    expect(parts).toEqual([
      { text: "あ", severity: null },
      { text: "い", severity: "low" },
      { text: "う", severity: "high" },
      { text: "え", severity: "low" },
      { text: "お", severity: null },
    ]);
  });
});

describe("markSpans", () => {
  it("範囲の内外で分ける", () => {
    expect(markSpans("あいうえお", [[1, 3]])).toEqual([
      { text: "あ", marked: false }, { text: "いう", marked: true }, { text: "えお", marked: false },
    ]);
  });
});

describe("止まった意味のチェック", () => {
  it("3分を超えて実行中のままなら、止まったものとみなす", () => {
    const started = new Date("2026-11-07T12:00:00Z");
    const runs = [run({ phase: "async", status: "running", startedAt: started })];
    const soon = summarize(runs, [], undefined, started.getTime() + 60_000);
    expect([soon.asyncPending, soon.asyncStalled]).toEqual([true, false]);
    const later = summarize(runs, [], undefined, started.getTime() + 4 * 60_000);
    expect([later.asyncPending, later.asyncStalled]).toEqual([false, true]);
  });
});
