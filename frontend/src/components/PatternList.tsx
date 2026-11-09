// 指摘されるパターン一覧。名前と重大度だけを並べ、行をタップすると定義・判定の目安・例が開く。
// 指摘されない例は B（語彙・表現）と D（構成・内容）だけに出す（作者独自の表現は指摘しないと伝えるため）。
// 結果が出る時期・根拠・「直すかどうかは作者が決める」の注意書きは出さない（設計書「アンチパターン一覧と判定方式」）。
// URL の #コード（例：/patterns#B1）で来たときは、そのパターンを開いて表示する。
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { CATEGORIES, PATTERNS, SEVERITY_LABEL, type PatternInfo } from "../lib/findings";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s", flex: "none" }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** 指摘されない例を出すカテゴリ。 */
const SHOW_NEGATIVE = new Set(["B", "D"]);

export function PatternList({ wide = false }: { wide?: boolean }) {
  const location = useLocation();
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const code = decodeURIComponent(location.hash.slice(1));
    if (code && PATTERNS.some((p) => p.code === code)) {
      setOpen((cur) => new Set(cur).add(code));
      window.setTimeout(() => document.getElementById(`pattern-${code}`)?.scrollIntoView({ block: "center" }), 0);
    }
  }, [location.hash]);

  const toggle = (code: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {Object.entries(CATEGORIES).map(([key, title]) => {
        const items = PATTERNS.filter((p) => p.category === key);
        return (
          <section key={key}>
            <h3 className={wide ? undefined : "group-title"} style={wide ? { margin: "20px 0 8px", fontSize: 13, fontWeight: 500, color: "var(--muted)" } : undefined}>
              {key} {title}{key === "E" && "（2稿目から）"}
            </h3>
            <ul className="card pattern-list" style={{ margin: wide ? 0 : "0 16px" }}>
              {items.map((p) => {
                const isOpen = open.has(p.code);
                return (
                  <li key={p.code} id={`pattern-${p.code}`}>
                    <button type="button" className="pattern-row" aria-expanded={isOpen} aria-controls={`pattern-body-${p.code}`} onClick={() => toggle(p.code)}>
                      <span className="small muted" style={{ width: 26, flex: "none", fontVariantNumeric: "tabular-nums", textAlign: "left" }}>{p.code}</span>
                      <span style={{ flexGrow: 1, fontSize: 14, textAlign: "left" }}>{p.name}</span>
                      <span className={`sev ${p.severity}`} style={{ width: 22, textAlign: "center", padding: "1px 0", flex: "none" }}>{SEVERITY_LABEL[p.severity]}</span>
                      <Chevron open={isOpen} />
                    </button>
                    {isOpen && <PatternDetail id={`pattern-body-${p.code}`} pattern={p} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PatternDetail({ id, pattern: p }: { id: string; pattern: PatternInfo }) {
  return (
    <div id={id} className="pattern-detail">
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>{p.definition}</p>
      <dl>
        <dt>判定の目安</dt>
        <dd>{p.criteria}</dd>
        {p.positive.length > 0 && (
          <>
            <dt>指摘される例</dt>
            <dd>
              <ul>{p.positive.map((x) => <li key={x}>{x}</li>)}</ul>
            </dd>
          </>
        )}
        {SHOW_NEGATIVE.has(p.category) && p.negative.length > 0 && (
          <>
            <dt>指摘されない例</dt>
            <dd>
              <ul>{p.negative.map((x) => <li key={x}>{x}</li>)}</ul>
            </dd>
          </>
        )}
        <dt>重大度</dt>
        <dd>{p.severityNote ?? `「${SEVERITY_LABEL[p.severity]}」`}</dd>
      </dl>
    </div>
  );
}
