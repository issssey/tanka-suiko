// PC版の連作。左に連作の一覧、右に選んだ連作の題と歌の並び
import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { PcHeader } from "../../components/pc";
import { LibraryTabs, SaveStatus, SequenceItems, TankaPickerSheet } from "../../components/library";
import { ConfirmDialog, formatDate, Loading, PlusIcon } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { usePublications, useSequence, useSequences, useTankas } from "../../lib/data";
import { sequenceTitle, staleCount } from "../../lib/publishing";
import { useCreateSequence, useSequenceEditor } from "../../lib/sequenceEditor";

export default function PcSequences() {
  const { sequenceId } = useParams();
  const { user } = useAuth();
  const { data: sequences, loading } = useSequences(user?.uid);
  const { data: tankas } = useTankas(user?.uid);
  const { data: pubs } = usePublications(user?.uid);
  const tankasById = useMemo(() => new Map(tankas.map((t) => [t.id, t])), [tankas]);
  const { create, busy, error } = useCreateSequence();

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
          <nav aria-label="連作一覧" className="pc-seq-list">
            {sequences.map((s) => {
              const stale = staleCount(s, tankasById);
              const published = pubs.some((p) => p.sequenceId === s.id);
              return (
                <Link key={s.id} to={`/sequences/${s.id}`} aria-current={s.id === sequenceId ? "page" : undefined}>
                  <span className="t">{sequenceTitle(s)}</span>
                  <span className="small muted">{s.items.length}首 · {formatDate(s.updatedAt)}</span>
                  <span className="chips">
                    {stale > 0 && <span className="chip stale">新しい稿 {stale}</span>}
                    {published ? <span className="chip outline-accent">発表済み</span> : <span className="chip neutral">未発表</span>}
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="pc-main pc-seq" style={{ gap: 20 }}>
          <LibraryTabs active="sequences" pc />
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
        <div className="pc-actions" style={{ display: "flex", gap: 8 }}>
          <button type="button" className="pc-btn danger" onClick={() => setConfirmDelete(true)}>連作を削除</button>
          {/* 作って終わりにしてよい。出すのは仕上がってからなので、控えめなボタンにする */}
          {ed.items.length > 0 ? (
            <Link to={`/publish?s=${seq.id}`} className="pc-btn" title="仕上がったら、出したときに記録します">この連作を出す</Link>
          ) : (
            <button type="button" className="pc-btn" disabled>この連作を出す</button>
          )}
        </div>
      </div>
      <span className="small muted" style={{ fontSize: 13 }}>
        {ed.items.length}首 · {ed.published ? "発表済み" : "未発表"} · 並べ替えはつまみをドラッグ。仕上がったら、出したときに記録します。連作を削除しても、中の短歌と発表記録は消えません
      </span>
      {ed.error && <p className="error" style={{ margin: 0 }}>{ed.error}</p>}
      <SequenceItems items={ed.items} tankasById={ed.tankasById} onChange={ed.setItems} disabled={ed.busy !== null} pc />
      <button type="button" className="add-dashed" disabled={ed.items.length >= 100} onClick={() => setAdding(true)}>
        <PlusIcon />
        歌を加える
      </button>
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
