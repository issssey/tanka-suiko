// 連作（スマホ）。題・並び・差し替えは変えたらすぐ保存する。
// 区画は 見出しと情報 → 中身（題と歌の並び）→ つながり → 履歴 → 操作 → 削除（設計書「詳細ページの構造」）
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DangerFooter, DeleteSequenceDialog, DetailSection, InfoRows, SequenceRelations, UndoBar } from "../components/detail";
import { SaveStatus, SequenceItems, TankaPickerSheet } from "../components/library";
import { formatDate, Loading, PlusIcon, TopBar } from "../components/ui";
import { useSequence } from "../lib/data";
import { sequenceTitle } from "../lib/publishing";
import { useSequenceEditor } from "../lib/sequenceEditor";

export default function SequencePage() {
  const { sequenceId = "" } = useParams();
  const { data: seq, loading } = useSequence(sequenceId);
  if (loading) return <Loading />;
  if (!seq) return <div className="center-msg">この連作は見つかりません。<Link to="/sequences">連作一覧へ</Link></div>;
  return <SequenceEditor key={seq.id} seqId={seq.id} />;
}

function SequenceEditor({ seqId }: { seqId: string }) {
  const { data: seq } = useSequence(seqId);
  const ed = useSequenceEditor(seq);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!seq) return null;
  return (
    <>
      <TopBar back="/sequences" backLabel="連作一覧に戻る" title={sequenceTitle({ title: ed.title })} sub={`${ed.items.length}首 · ${formatDate(seq.updatedAt)}`} />
      <div className="seq-title-field">
        <label htmlFor="seq-title" className="small muted" style={{ fontWeight: 500 }}>題</label>
        <input id="seq-title" className="seq-title-input" type="text" maxLength={100} placeholder="題を入れる" {...ed.titleProps} />
        <SaveStatus state={ed.saveState} savedAt={ed.savedAt} />
      </div>
      <SequenceItems items={ed.items} tankasById={ed.tankasById} onChange={ed.setItems} onRemove={ed.removeItem} disabled={ed.busy === "delete"} />
      {ed.items.length === 0 && <p className="muted small" style={{ margin: "0 20px" }}>まだ歌が入っていません。</p>}
      <button type="button" className="add-dashed" disabled={ed.items.length >= 100} onClick={() => setAdding(true)}>
        <PlusIcon />
        歌を加える
      </button>
      {ed.error && <p className="error">{ed.error}</p>}

      <SequenceRelations seq={seq} />
      <DetailSection title="履歴">
        <InfoRows rows={[["作った日", formatDate(seq.createdAt)], ["最後に直した日", formatDate(seq.updatedAt)]]} />
      </DetailSection>
      <DetailSection title="操作">
        <div className="detail-actions">
          {ed.items.length > 0 ? (
            <Link to={`/publish?s=${seq.id}`} className="btn-secondary">発表を記録</Link>
          ) : (
            <button type="button" className="btn-secondary" disabled>発表を記録</button>
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
