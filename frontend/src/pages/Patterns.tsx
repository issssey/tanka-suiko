import { PatternList } from "../components/PatternList";
import { TopBar } from "../components/ui";

export default function PatternsPage() {
  return (
    <>
      <TopBar back="/settings" backLabel="設定に戻る" title="指摘されるパターン一覧" />
      <PatternList />
      <div style={{ height: 32 }} />
    </>
  );
}
