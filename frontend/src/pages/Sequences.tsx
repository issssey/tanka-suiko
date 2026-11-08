// 連作一覧（スマホ）
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { LibraryTabs } from "../components/library";
import { formatDate, GearIcon, Loading, PlusIcon } from "../components/ui";
import { useAuth } from "../lib/auth";
import { usePublications, useRevision, useSequences, useTankas } from "../lib/data";
import { sequenceTitle, staleCount } from "../lib/publishing";
import { useCreateSequence } from "../lib/sequenceEditor";
import type { Sequence, Tanka } from "../lib/types";

export function LibraryHeader() {
  return (
    <header className="page-header">
      <h1 className="brand">推敲帖</h1>
      <Link to="/settings" className="icon-btn" aria-label="設定" style={{ color: "var(--muted)" }}>
        <GearIcon />
      </Link>
    </header>
  );
}

export default function SequencesPage() {
  const { user } = useAuth();
  const { data: sequences, loading } = useSequences(user?.uid);
  const { data: tankas } = useTankas(user?.uid);
  const { data: pubs } = usePublications(user?.uid);
  const tankasById = useMemo(() => new Map(tankas.map((t) => [t.id, t])), [tankas]);
  const { create, busy, error } = useCreateSequence();

  return (
    <>
      <LibraryHeader />
      <LibraryTabs active="sequences" />
      {loading ? (
        <Loading />
      ) : sequences.length === 0 ? (
        <div className="empty-center" style={{ flex: "none", padding: "40px 28px" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>まだ連作がありません</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
            題を付けて歌を並べると、作品としてまとめられます。未発表・推敲中の歌も入れられます。
          </p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, padding: "0 20px 12px", fontSize: 13 }}>{sequences.length}つ · 最近更新した順</p>
          <div className="stack" style={{ paddingBottom: 120 }}>
            {sequences.map((s) => (
              <SequenceCard key={s.id} seq={s} tankasById={tankasById} published={pubs.some((p) => p.sequenceId === s.id)} />
            ))}
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button type="button" className="fab" style={{ border: "none", cursor: "pointer", fontFamily: "var(--sans)" }} disabled={busy} onClick={create}>
        <PlusIcon />
        新しい連作
      </button>
    </>
  );
}

function SequenceCard({ seq, tankasById, published }: { seq: Sequence; tankasById: Map<string, Tanka>; published: boolean }) {
  const first = seq.items[0];
  const { data: rev } = useRevision(first?.tankaId, first?.revisionId);
  const stale = staleCount(seq, tankasById);
  return (
    <Link to={`/sequences/${seq.id}`} className="card tanka-card" style={{ gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span className="serif" style={{ fontSize: 18, fontWeight: 600 }}>{sequenceTitle(seq)}</span>
        <span className="small muted" style={{ flexShrink: 0 }}>{seq.items.length}首 · {formatDate(seq.updatedAt)}</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {first ? <>一首目：<span className="serif" style={{ color: "var(--text-2)" }}>{rev?.bodyNormalized ?? ""}</span></> : "まだ歌が入っていません"}
      </p>
      <div className="chips">
        {stale > 0 && <span className="chip stale">新しい稿 {stale}</span>}
        {published ? <span className="chip outline-accent">発表済み</span> : <span className="chip neutral">未発表</span>}
      </div>
    </Link>
  );
}
