// PC版の共通部品：上部ヘッダー、左の短歌リスト、縦書きの本文
import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTankas } from "../lib/data";
import type { Finding, Segment, Severity } from "../lib/types";
import { PlusIcon } from "./ui";

export function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

/** いまの画面がどの欄か（ヘッダーで下線を引く）。 */
function sectionOf(pathname: string): "tankas" | "sequences" | "publications" | "settings" {
  if (pathname.startsWith("/sequences")) return "sequences";
  if (pathname.startsWith("/publications") || pathname.startsWith("/publish")) return "publications";
  if (pathname.startsWith("/settings") || pathname.startsWith("/patterns")) return "settings";
  return "tankas";
}

/** PC版のヘッダー。短歌・連作・発表記録・設定を切り替える。 */
export function PcHeader() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const initial = (user?.displayName || user?.email || "歌").slice(0, 1);
  const current = sectionOf(pathname);
  const links = [
    { key: "tankas", to: "/", label: "短歌" },
    { key: "sequences", to: "/sequences", label: "連作" },
    { key: "publications", to: "/publications", label: "発表記録" },
    { key: "settings", to: "/settings", label: "設定" },
  ] as const;
  return (
    <header className="pc-header">
      <Link to="/" className="pc-logo">推敲帖</Link>
      <nav aria-label="アカウント" className="pc-nav">
        {links.map((l) => (
          <Link key={l.key} to={l.to} aria-current={current === l.key ? "page" : undefined} className={l.key === "settings" ? "settings" : undefined}>
            {l.label}
          </Link>
        ))}
        <span aria-hidden="true" className="pc-avatar">{initial}</span>
      </nav>
    </header>
  );
}

/** 左の列の検索欄。 */
export function SideSearch({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="pc-side-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5F5B53" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <span className="sr-only">{label}</span>
      <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** 左に短歌のリストを置いたPC版の画面。aside は右の列（読み・指摘など）。 */
export function PcShell({ activeTankaId, children, aside, asideLabel }: { activeTankaId?: string; children: ReactNode; aside?: ReactNode; asideLabel?: string }) {
  return (
    <div className="pc pc-fixed">
      <PcHeader />
      <div className="pc-body">
        <PcSidebar activeTankaId={activeTankaId} />
        <main className="pc-main">{children}</main>
        {aside && (
          <aside className="pc-aside" aria-label={asideLabel}>
            {aside}
          </aside>
        )}
      </div>
    </div>
  );
}

function PcSidebar({ activeTankaId }: { activeTankaId?: string }) {
  const { user } = useAuth();
  const { data: tankas, loading } = useTankas(user?.uid);
  const [q, setQ] = useState("");
  const list = tankas.filter((t) => t.currentRevisionId);
  const shown = q.trim() ? list.filter((t) => (t.latestBody ?? "").includes(q.trim())) : list;
  return (
    <aside className="pc-sidebar">
      <Link to="/new" className="btn-primary pc-new">
        <PlusIcon />
        新しい短歌
      </Link>
      {!loading && list.length === 0 ? (
        <p className="small muted" style={{ margin: 0, padding: 12, fontSize: 13, lineHeight: 1.7 }}>書いた短歌はここに並びます。</p>
      ) : (
        <SideSearch label="短歌を検索" placeholder="本文で探す" value={q} onChange={setQ} />
      )}
      {q.trim() && shown.length === 0 && <p className="small muted" style={{ margin: 0, padding: "0 12px" }}>「{q}」を含む短歌はありません。</p>}
      <nav aria-label="短歌一覧" className="pc-tanka-list">
        {shown
          .map((t) => (
            <Link
              key={t.id}
              to={`/t/${t.id}/r/${t.currentRevisionId}`}
              aria-current={t.id === activeTankaId ? "page" : undefined}
            >
              <span className="serif pc-tanka-line">{t.latestBody}</span>
              <span className="small">第{t.latestRevisionNo}稿</span>
            </Link>
          ))}
      </nav>
    </aside>
  );
}

const HL_CLASS: Record<Severity, string> = { high: "vhl-high", medium: "vhl-medium", low: "vhl-low" };
const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** 縦書きの本文。上の句（一〜三句）と下の句（四・五句）で改行し、下の句を字下げする。 */
export function VerticalPoem({ text, segments, findings }: { text: string; segments: Segment[]; findings: Finding[] }) {
  const lowerStart = segments.find((s) => s.no === 4)?.span[0] ?? text.length;
  const marks: (Severity | null)[] = Array.from({ length: text.length }, () => null);
  for (const f of findings) {
    if (!f.span) continue;
    for (let i = f.span[0]; i < Math.min(f.span[1], text.length); i++) {
      const cur = marks[i];
      if (cur === null || ORDER[f.severity] < ORDER[cur]) marks[i] = f.severity;
    }
  }
  const render = (from: number, to: number) => {
    const parts: { text: string; sev: Severity | null }[] = [];
    for (let i = from; i < to; i++) {
      const last = parts[parts.length - 1];
      if (last && last.sev === marks[i]) last.text += text[i];
      else parts.push({ text: text[i], sev: marks[i] });
    }
    return parts.map((p, i) => (p.sev ? <span key={i} className={HL_CLASS[p.sev]}>{p.text}</span> : <span key={i}>{p.text}</span>));
  };
  return (
    <section aria-label="本文" className="card pc-poem">
      <p>
        {render(0, lowerStart)}
        <br />
        <span className="pc-lower">{render(lowerStart, text.length)}</span>
      </p>
    </section>
  );
}

export function PcTally({ counts }: { counts: { resolved: number; continued: number; new: number } }) {
  return (
    <div className="pc-tally">
      <div className="resolved"><span className="n">{counts.resolved}</span><span className="l">前の稿から解消</span></div>
      <div className="continued"><span className="n">{counts.continued}</span><span className="l">継続</span></div>
      <div className="new"><span className="n">{counts.new}</span><span className="l">新規</span></div>
    </div>
  );
}
