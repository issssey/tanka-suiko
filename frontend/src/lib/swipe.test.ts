import { describe, expect, it } from "vitest";
import { swipeTarget } from "./swipe";

const W = 390;
describe("一覧のスワイプ", () => {
  it("左へスワイプで次、右へで前", () => {
    expect(swipeTarget("tankas", { x: 300, y: 400 }, { x: 150, y: 410 }, W)).toBe("sequences");
    expect(swipeTarget("sequences", { x: 300, y: 400 }, { x: 150, y: 400 }, W)).toBe("publications");
    expect(swipeTarget("publications", { x: 100, y: 400 }, { x: 250, y: 400 }, W)).toBe("sequences");
  });
  it("端のタブより先へは行かない", () => {
    expect(swipeTarget("tankas", { x: 100, y: 400 }, { x: 250, y: 400 }, W)).toBe("notes");
    expect(swipeTarget("notes", { x: 100, y: 400 }, { x: 250, y: 400 }, W)).toBeNull();
    expect(swipeTarget("publications", { x: 300, y: 400 }, { x: 150, y: 400 }, W)).toBeNull();
  });
  it("短い動き・縦のスクロール・画面の端からは切り替えない", () => {
    expect(swipeTarget("tankas", { x: 300, y: 400 }, { x: 260, y: 400 }, W)).toBeNull();
    expect(swipeTarget("tankas", { x: 300, y: 400 }, { x: 200, y: 250 }, W)).toBeNull();
    expect(swipeTarget("sequences", { x: 10, y: 400 }, { x: 200, y: 400 }, W)).toBeNull();
    expect(swipeTarget("sequences", { x: 385, y: 400 }, { x: 200, y: 400 }, W)).toBeNull();
  });
});
