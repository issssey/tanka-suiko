import { PATTERNS } from "../lib/findings";
import { PatternList } from "../components/PatternList";
import { TopBar } from "../components/ui";

export default function PatternsPage() {
  const syncCount = PATTERNS.filter((p) => p.phase === "sync").length;
  return (
    <>
      <TopBar back="/settings" backLabel="設定に戻る" title="指摘されるパターン一覧" />
      <p className="muted" style={{ margin: 0, padding: "4px 20px 8px", fontSize: 13, lineHeight: 1.7 }}>
        {PATTERNS.length}のパターンを確認します。「即時」の{syncCount}項目は保存と同時に、「後から」は保存後30秒ほどで結果が出ます。
        パターンをタップすると、説明と例が開きます。
      </p>
      <PatternList />
      <div style={{ height: 32 }} />
    </>
  );
}
