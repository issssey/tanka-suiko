import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { findingTitle, highlightParts, SEVERITY_LABEL } from "../lib/findings";
import type { Finding, Severity, Transition } from "../lib/types";

export function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#27467A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v10h12V10" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

/** 下層画面のヘッダー。右端に一覧（トップ）へ戻る家のアイコンを置く。 */
export function TopBar({ back, backLabel, title, sub, right, home = true }: { back: string; backLabel: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; home?: boolean }) {
  return (
    <header className="topbar">
      <Link to={back} className="icon-btn" aria-label={backLabel}>
        <BackIcon />
      </Link>
      <div className="titles">
        <span className="title">{title}</span>
        {sub && <span className="sub">{sub}</span>}
      </div>
      {right}
      {home && (
        <Link to="/" className="icon-btn" aria-label="短歌一覧（トップ）に戻る" style={{ color: "var(--muted)" }}>
          <HomeIcon />
        </Link>
      )}
    </header>
  );
}

/** 題の代わりに、本文の冒頭で短歌を見分ける。 */
export function snippet(body: string | null | undefined, length = 10): string {
  if (!body) return "";
  return body.length > length ? `${body.slice(0, length)}…` : body;
}

/** 削除の確認。スマホでは下から出るシート、広い画面では中央のダイアログになる。 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="dialog-layer">
      <button type="button" className="dialog-backdrop" aria-label="閉じる" onClick={onCancel} />
      <section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="dialog">
        <div aria-hidden="true" className="dialog-handle" />
        <h2 id="dialog-title" style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{title}</h2>
        {children}
        <div className="dialog-actions">
          <button type="button" className="btn-danger" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
          <button type="button" ref={cancelRef} className="btn-secondary" disabled={busy} onClick={onCancel}>キャンセル</button>
        </div>
      </section>
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`sev ${severity}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function TransitionBadge({ transition }: { transition: Transition }) {
  return <span className={`trans ${transition}`}>{transition === "new" ? "新規" : "継続"}</span>;
}

export function HighlightedPoem({ text, findings }: { text: string; findings: Finding[] }) {
  return (
    <>
      {highlightParts(text, findings).map((p, i) =>
        p.severity ? (
          <span key={i} className={`hl-${p.severity}`}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function FindingCard({
  finding,
  detailHref,
  onJudge,
  busy,
}: {
  finding: Finding;
  detailHref: string;
  onJudge?: (status: "intentional" | "false_positive") => void;
  busy?: boolean;
}) {
  return (
    <article className="card finding">
      <div className="head">
        <SeverityBadge severity={finding.severity} />
        <Link to={detailHref} className="name">
          {findingTitle(finding)}
        </Link>
        <span className="code">{finding.code}</span>
        <TransitionBadge transition={finding.transition} />
      </div>
      <p className="msg">{finding.message}</p>
      {onJudge && (
        <div className="row-buttons">
          <button type="button" className="btn" disabled={busy} onClick={() => onJudge("intentional")}>
            意図的
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => onJudge("false_positive")}>
            誤検出
          </button>
        </div>
      )}
    </article>
  );
}

export function formatDate(d: Date | undefined | null): string {
  if (!d) return "";
  const now = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `今日 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDay(d: Date | undefined | null): string {
  if (!d) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `今日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function Loading() {
  return <div className="center-msg">読み込み中…</div>;
}
