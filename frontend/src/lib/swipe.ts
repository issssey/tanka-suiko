// 一覧（短歌・連作・発表記録）を左右のスワイプで切り替える判定。

export const LIBRARY_TABS = ["tankas", "sequences", "publications"] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

/** 画面の端からのスワイプは iPhone の「戻る」操作に任せる（この幅より内側から始めたものだけ見る）。 */
export const EDGE_GUARD = 24;
/** これだけ横に動いたら切り替える。 */
export const MIN_DISTANCE = 60;

/**
 * 指を置いた位置と離した位置から、移る先のタブを返す。動かないなら null。
 * 左へスワイプ（指が右から左）で次のタブ、右へスワイプで前のタブ。縦の動きが大きいときはスクロールとみなす。
 */
export function swipeTarget(
  active: LibraryTab,
  start: { x: number; y: number },
  end: { x: number; y: number },
  viewportWidth: number,
): LibraryTab | null {
  if (start.x < EDGE_GUARD || start.x > viewportWidth - EDGE_GUARD) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  const i = LIBRARY_TABS.indexOf(active) + (dx < 0 ? 1 : -1);
  return i >= 0 && i < LIBRARY_TABS.length ? LIBRARY_TABS[i] : null;
}
