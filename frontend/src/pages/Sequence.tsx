// 連作（スマホ）。題・並び・差し替えは変えたらすぐ保存する
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SaveStatus, SequenceItems, TankaPickerSheet } from "../components/library";
import { ConfirmDialog, Loading, PlusIcon, TopBar } from "../components/ui";
import { useSequence } from "../lib/data";
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
      <TopBar back="/sequences" backLabel="連作一覧に戻る" title="連作" sub={`${ed.items.length}首 · ${ed.published ? "発表済み" : "未発表"}`} />
      <div className="seq-title-field">
        <label htmlFor="seq-title" className="small muted" style={{ fontWeight: 500 }}>題</label>
        <input id="seq-title" className="seq-title-input" type="text" maxLength={100} placeholder="題を入れる" {...ed.titleProps} />
        <SaveStatus state={ed.saveState} savedAt={ed.savedAt} />
      </div>
      <SequenceItems items={ed.items} tankasById={ed.tankasById} onChange={ed.setItems} disabled={ed.busy !== null} />
      {ed.items.length === 0 && <p className="muted small" style={{ margin: "0 20px" }}>まだ歌が入っていません。</p>}
      <button type="button" className="add-dashed" disabled={ed.items.length >= 100} onClick={() => setAdding(true)}>
        <PlusIcon />
        歌を加える
      </button>
      {ed.error && <p className="error">{ed.error}</p>}
      <div className="footer-bar" style={{ marginTop: 24 }}>
        {/* 作って終わりにしてよい。出すのは仕上がってからなので、控えめなボタンにする */}
        {ed.items.length > 0 ? (
          <Link to={`/publish?s=${seq.id}`} className="btn-secondary">この連作を出す（発表を記録）</Link>
        ) : (
          <button type="button" className="btn-secondary" disabled>この連作を出す（発表を記録）</button>
        )}
        <p className="hint" style={{ textAlign: "center" }}>仕上がったら、出したときに記録します</p>
        <button type="button" className="text-btn danger" style={{ alignSelf: "center", height: 40 }} onClick={() => setConfirmDelete(true)}>
          連作を削除（中の短歌は消えません）
        </button>
      </div>
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
        <ConfirmDialog title="この連作を削除しますか？" confirmLabel="連作を削除する" busy={ed.busy === "delete"} onConfirm={ed.remove} onCancel={() => setConfirmDelete(false)}>
          <p className="quote">{ed.title.trim() || "無題の連作"}</p>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>中の短歌と発表記録は消えません。</p>
        </ConfirmDialog>
      )}
    </>
  );
}

