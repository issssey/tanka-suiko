// PC版の連作。左に連作の一覧、右に選んだ連作の題と歌の並び
import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { PcHeader, SideSearch } from "../../components/pc";
import { SaveStatus, SequenceItems, TankaPickerSheet } from "../../components/library";
import { DangerFooter, DeleteSequenceDialog, DetailSection, InfoRows, SequenceRelations, UndoBar } from "../../components/detail";
import { formatDate, Loading, PlusIcon } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { usePublications, useRevision, useSequence, useSequences, useTankas } from "../../lib/data";
import { sequencePublicationChip, sequenceTitle, staleCount } from "../../lib/publishing";
import { useCreateSequence, useSequenceEditor } from "../../lib/sequenceEditor";

export default function PcSequences() {
  const { sequenceId } = useParams();
  const { user } = useAuth();
  const { data: sequences, loading } = useSequences(user?.uid);
  const { data: tankas } = useTankas(user?.uid);
  const { data: pubs } = usePublications(user?.uid);
  const tankasById = useMemo(() => new Map(tankas.map((t) => [t.id, t])), [tankas]);
  const { create, busy, error } = useCreateSequence();
  const [q, setQ] = useState("");
  const shown = q.trim() ? sequences.filter((s) => sequenceTitle(s).includes(q.trim())) : sequences;

  if (!sequenceId && !loading && sequences.length > 0) return <Navigate to={`/sequences/${sequences[0].id}`} replace />;

  return (
    <div className="pc">
      <PcHeader />
      <div className="pc-body">
        <aside className="pc-sidebar">
          <button type="button" className="btn-primary pc-new" disabled={busy} onClick={create}>
            <PlusIcon />
            新しい連作
          </button>
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
          {sequences.length > 0 && <SideSearch label="連作を検索" placeholder="題で探す" value={q} onChange={setQ} />}
          {q.trim() && shown.length === 0 && <p className="small muted" style={{ margin: 0, padding: "0 12px" }}>「{q}」を題に含む連作はありません。</p>}
          <nav aria-label="連作一覧" className="pc-seq-list">
            {shown.map((s) => {
              const stale = staleCount(s, tankasById);
              const published = sequencePublicationChip(s, pubs);
              return (
                <Link key={s.id} to={`/sequences/${s.id}`} aria-current={s.id === sequenceId ? "page" : undefined}>
                  <span className="t">{sequenceTitle(s)}</span>
                  {s.items[0] && <FirstLine tankaId={s.items[0].tankaId} revisionId={s.items[0].revisionId} />}
                  <span className="small muted">{s.items.length}首 · {formatDate(s.updatedAt)}</span>
                  {(stale > 0 || published) && (
                    <span className="chips">
                      {stale > 0 && <span className="chip stale">新しい稿あり</span>}
                      {published && <span className="chip outline">{published}</span>}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="pc-main pc-seq" style={{ gap: 20 }}>
          {loading ? (
            <Loading />
          ) : sequenceId ? (
            <PcSequenceEditor key={sequenceId} sequenceId={sequenceId} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
              <h1 style={{ margin: 0, fontSize: 22 }}>まだ連作がありません</h1>
              <p className="muted" style={{ margin: 0, lineHeight: 1.8 }}>題を付けて歌を並べると、作品としてまとめられます。未発表・推敲中の歌も入れられます。左の「新しい連作」から作れます。</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function PcSequenceEditor({ sequenceId }: { sequenceId: string }) {
  const { data: seq, loading } = useSequence(sequenceId);
  const ed = useSequenceEditor(seq);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (loading) return <Loading />;
  if (!seq) return <p className="muted">この連作は見つかりません。</p>;
  return (
    <>
      <div className="pc-titlebar">
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, maxWidth: 480 }}>
          <label htmlFor="pcseq-title" className="small muted" style={{ fontWeight: 500 }}>題</label>
          <input id="pcseq-title" className="seq-title-input" style={{ height: 52, fontSize: 24, padding: "0 16px" }} type="text" maxLength={100} placeholder="題を入れる" {...ed.titleProps} />
          <SaveStatus state={ed.saveState} savedAt={ed.savedAt} />
        </div>
      </div>
      <span className="small muted" style={{ fontSize: 13 }}>
        {ed.items.length}首 · {formatDate(seq.updatedAt)} · 並べ替えはつまみをドラッグ
      </span>
      {ed.error && <p className="error" style={{ margin: 0 }}>{ed.error}</p>}
      <SequenceItems items={ed.items} tankasById={ed.tankasById} onChange={ed.setItems} onRemove={ed.removeItem} disabled={ed.busy === "delete"} pc />
      <button type="button" className="add-dashed" disabled={ed.items.length >= 100} onClick={() => setAdding(true)}>
        <PlusIcon />
        歌を加える
      </button>
      <SequenceRelations seq={seq} />
      <DetailSection title="履歴">
        <InfoRows rows={[["作った日", formatDate(seq.createdAt)], ["最後に直した日", formatDate(seq.updatedAt)]]} />
      </DetailSection>
      <DetailSection title="操作">
        <div className="detail-actions">
          {ed.items.length > 0 ? (
            <Link to={`/publish?s=${seq.id}`} className="btn-secondary" style={{ maxWidth: 320 }}>発表を記録</Link>
          ) : (
            <button type="button" className="btn-secondary" style={{ maxWidth: 320 }} disabled>発表を記録</button>
          )}
        </div>
      </DetailSection>
      <DangerFooter label="この連作を削除" onClick={() => setConfirmDelete(true)} />
      {ed.undo && <UndoBar tanka={ed.tankasById.get(ed.undo.removed.tankaId)} onUndo={ed.undoRemove} />}
      {adding && (
        <TankaPickerSheet
          exclude={ed.items.map((i) => i.tankaId)}
          onPick={(id) => {
            ed.addTanka(id);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {confirmDelete && (
        <DeleteSequenceDialog title={ed.title} count={ed.items.length} busy={ed.busy === "delete"} onConfirm={ed.remove} onCancel={() => setConfirmDelete(false)} />
      )}
    </>
  );
}

/** 左の一覧に出す一首目の本文（2行まで）。 */
function FirstLine({ tankaId, revisionId }: { tankaId: string; revisionId: string }) {
  const { data: rev } = useRevision(tankaId, revisionId);
  return <span className="serif pc-tanka-line" style={{ color: "var(--text-2)" }}>{rev?.bodyNormalized ?? ""}</span>;
}
