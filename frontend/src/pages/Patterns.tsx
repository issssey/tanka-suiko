import { CATEGORIES, PATTERNS, SEVERITY_LABEL } from "../lib/findings";
import { TopBar } from "../components/ui";

export default function PatternsPage() {
  const groups = Object.entries(CATEGORIES).map(([key, title]) => ({
    key,
    title: key === "E" ? `${key} ${title}（2稿目から）` : `${key} ${title}`,
    items: PATTERNS.filter((p) => p.category === key),
  }));
  const syncCount = PATTERNS.filter((p) => p.phase === "sync").length;

  return (
    <>
      <TopBar back="/settings" backLabel="設定に戻る" title="指摘されるパターン一覧" />
      <p className="muted" style={{ margin: 0, padding: "4px 20px 8px", fontSize: 13, lineHeight: 1.7 }}>
        {PATTERNS.length}のパターンを確認します。「即時」の{syncCount}項目は保存と同時に、「後から」は保存後30秒ほどで結果が出ます。どれも、直すかどうかはあなたが決めます。
      </p>
      {groups.map((g) => (
        <section key={g.key}>
          <h2 className="group-title">{g.title}</h2>
          <ul className="card" style={{ listStyle: "none", margin: "0 16px", padding: "0 16px" }}>
            {g.items.map((p, i) => (
              <li key={p.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 0", borderBottom: i < g.items.length - 1 ? "1px solid var(--line-2)" : undefined }}>
                <span className="small muted" style={{ width: 26, fontVariantNumeric: "tabular-nums" }}>{p.code}</span>
                <span style={{ flexGrow: 1, fontSize: 14 }} title={p.severityNote ?? undefined}>{p.name}</span>
                <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 999, border: `1px solid ${p.phase === "sync" ? "var(--accent)" : "var(--neutral-line)"}`, color: p.phase === "sync" ? "var(--accent)" : "var(--muted)" }}>
                  {p.phase === "sync" ? "即時" : "後から"}
                </span>
                <span className={`sev ${p.severity}`} style={{ width: 22, textAlign: "center", padding: "1px 0" }}>{SEVERITY_LABEL[p.severity]}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="small muted" style={{ margin: "16px 20px 32px", lineHeight: 1.7 }}>A1は字足らずが「高」、字余りが「中」です。</p>
    </>
  );
}
