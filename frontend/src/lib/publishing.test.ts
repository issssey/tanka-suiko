import { describe, expect, it } from "vitest";
import {
  duplicateLine, formatDay, kanjiNumber, publicationChanged, publicationSummary, sequenceDuplicateLine, sequencePublicationChip,
  tankaPublicationChip, tankaSequenceChip, todayISO,
} from "./publishing";
import type { Publication } from "./types";

const pub = (over: Partial<Publication> = {}): Publication => ({
  id: "p1", authorId: "u1", destination: "みなと新聞 歌壇", submittedOn: "2026-11-07", note: null,
  sequenceId: null, sequenceTitle: null,
  items: [{ tankaId: "t1", revisionId: "r3", revisionNo: 3, body: "夕暮れの" }], tankaIds: ["t1"],
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe("publishing", () => {
  it("漢数字", () => {
    expect([1, 2, 10, 11, 20, 35, 99, 100].map(kanjiNumber)).toEqual(["一", "二", "十", "十一", "二十", "三十五", "九十九", "百"]);
  });
  it("日付", () => {
    const now = new Date(2026, 10, 8);
    expect(todayISO(now)).toBe("2026-11-08");
    expect(formatDay("2026-11-07", "short", now)).toBe("11月7日");
    expect(formatDay("2025-03-01", "short", now)).toBe("2025年3月1日");
    expect(formatDay("2026-11-07")).toBe("2026年11月7日");
  });
  it("何を出したか", () => {
    expect(publicationSummary(pub())).toBe("1首 · 第3稿");
    expect(publicationSummary(pub({ sequenceId: "s1", sequenceTitle: "冬のはじまり" }))).toBe("連作「冬のはじまり」1首");
    expect(duplicateLine(pub(), "t1")).toMatch(/「みなと新聞 歌壇」に第3稿を出しています。$/);
  });
  it("連作を出すときの警告は、どの歌かを示す", () => {
    const seq = { id: "s1", items: [{ tankaId: "t1", revisionId: "r4" }, { tankaId: "t2", revisionId: "r1" }] };
    const single = pub({ items: [{ tankaId: "t1", revisionId: "r3", revisionNo: 3, body: "夕暮れの駅のホームで寂しくて" }] });
    expect(sequenceDuplicateLine(single, seq)).toMatch(/^「夕暮れの駅のホー…」は.*に「みなと新聞 歌壇」に出しています。$/);
    expect(sequenceDuplicateLine(pub({ sequenceId: "s1", sequenceTitle: "駅の灯" }), seq)).toMatch(/^この連作は/);
  });
});

describe("出した後の変更", () => {
  const base = {
    id: "p1", authorId: "u1", destination: "賞", submittedOn: "2026-10-20", note: null, sequenceId: "s1", sequenceTitle: "冬",
    items: [{ tankaId: "t1", revisionId: "r1", revisionNo: 1, body: "a" }, { tankaId: "t2", revisionId: "r2", revisionNo: 2, body: "b" }],
    tankaIds: ["t1", "t2"], createdAt: new Date(), updatedAt: new Date(),
  };
  const items = [{ tankaId: "t1", revisionId: "r1" }, { tankaId: "t2", revisionId: "r2" }];
  it("同じなら変更なし", () => expect(publicationChanged(base, { title: "冬", items })).toBe(false));
  it("題・並び・稿が変われば変更あり", () => {
    expect(publicationChanged(base, { title: "冬の歌", items })).toBe(true);
    expect(publicationChanged(base, { title: "冬", items: [items[1], items[0]] })).toBe(true);
    expect(publicationChanged(base, { title: "冬", items: [items[0], { tankaId: "t2", revisionId: "r3" }] })).toBe(true);
    expect(publicationChanged(base, { title: "冬", items: [items[0]] })).toBe(true);
  });
});

describe("一覧のカードのチップ", () => {
  const seq = (id: string, title: string, updated: number) => ({
    id, authorId: "u1", title, items: [{ tankaId: "t1", revisionId: "r1" }], note: null, createdAt: new Date(0), updatedAt: new Date(updated),
  });
  it("発表は新しい記録の出し先に「ほか N件」", () => {
    const pubs = [
      pub({ id: "a", destination: "SNS", submittedOn: "2026-09-03" }),
      pub({ id: "b", destination: "みなと新聞 歌壇", submittedOn: "2026-11-07" }),
    ];
    expect(tankaPublicationChip({ id: "t1", publishedCount: 2 }, pubs)).toBe("発表：みなと新聞 歌壇 ほか1件");
    expect(tankaPublicationChip({ id: "t1", publishedCount: 1 }, pubs.slice(0, 1))).toBe("発表：SNS");
    expect(tankaPublicationChip({ id: "t2", publishedCount: 0 }, pubs)).toBeNull();
    // 記録を読み込む前は数だけで出す
    expect(tankaPublicationChip({ id: "t1", publishedCount: 1 }, [])).toBe("発表済み");
  });
  it("連作は最近更新した連作の題", () => {
    const seqs = [seq("s1", "冬のはじまり", 1), seq("s2", "", 2)];
    expect(tankaSequenceChip({ id: "t1", sequenceIds: ["s1", "s2"] }, seqs)).toBe("連作：無題の連作 ほか1件");
    expect(tankaSequenceChip({ id: "t1", sequenceIds: ["s1"] }, seqs.slice(0, 1))).toBe("連作：冬のはじまり");
    expect(tankaSequenceChip({ id: "t9", sequenceIds: [] }, seqs)).toBeNull();
  });
  it("連作を出した記録", () => {
    expect(sequencePublicationChip({ id: "s1" }, [pub({ sequenceId: "s1", destination: "青嶺短歌賞" })])).toBe("発表：青嶺短歌賞");
    expect(sequencePublicationChip({ id: "s2" }, [pub({ sequenceId: "s1" })])).toBeNull();
  });
});
