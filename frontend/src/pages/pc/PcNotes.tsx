// PC版の気づき。左に一覧（検索付き）、右に選んだ気づきの詳細（その場で直して自動で保存）か、書き留めるフォーム
import { useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { DetailSection } from "../../components/detail";
import { filterNotes, NOTE_MAX, NoteCard, NoteDeleteButton, NoteHistory, NoteInlineEditor, NoteRelations, songsOf, useTankasById } from "../../components/notes";
import { PcHeader, SideSearch } from "../../components/pc";
import { formatDate, Loading, PlusIcon } from "../../components/ui";
import { createNote } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useNote, useNotes } from "../../lib/data";

function PcNotesLayout({ activeId, writing, children }: { activeId?: string; writing?: boolean; children: ReactNode }) {
  const { user } = useAuth();
  const { data: notes } = useNotes(user?.uid);
  const tankasById = useTankasById();
  const [q, setQ] = useState("");
  const shown = filterNotes(notes, q);
  return (
    <div className="pc">
      <PcHeader />
      <div className="pc-body">
        <aside className="pc-sidebar" style={{ flexBasis: 300 }}>
          <Link to="/notes/new" className="btn-primary pc-new" aria-current={writing ? "page" : undefined}>
            <PlusIcon />
            書き留める
          </Link>
          {notes.length > 0 && <SideSearch label="気づきを検索" placeholder="本文で探す" value={q} onChange={setQ} />}
          {notes.length > 0 && <span className="small muted" style={{ padding: "0 4px" }}>{notes.length}件 · 新しい順</span>}
          {q.trim() && shown.length === 0 && <p className="small muted" style={{ margin: 0, padding: "0 12px" }}>「{q}」を含む気づきはありません。</p>}
          <nav aria-label="気づきの一覧" className="pc-pub-list pc-note-list">
            {shown.map((n) => (
              <NoteCard key={n.id} note={n} songs={songsOf(n, tankasById).length} to={`/notes/${n.id}`} current={n.id === activeId} compact />
            ))}
          </nav>
        </aside>
        <main className="pc-main" style={{ maxWidth: 920 }}>{children}</main>
      </div>
    </div>
  );
}

/** /notes：気づきがあれば最新を開く。なければ書き留めるフォーム。 */
export default function PcNotes() {
  const { user } = useAuth();
  const { data: notes, loading } = useNotes(user?.uid);
  if (loading) return <PcNotesLayout><Loading /></PcNotesLayout>;
  if (notes.length > 0) return <Navigate to={`/notes/${notes[0].id}`} replace />;
  return <PcNoteNew empty />;
}

export function PcNoteNew({ empty }: { empty?: boolean }) {
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const n = await createNote(body);
      navigate(`/notes/${n.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
      setBusy(false);
    }
  }
  return (
    <PcNotesLayout writing>
      <div className="pc-titlebar">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1>気づきを書き留める</h1>
          <span className="meta">{empty ? "ふと気づいたこと、目に留まったものを短く残しておけます。あとで見返して、そこから歌を書き始められます。" : "あとで見返して、そこから歌を書き始められます"}</span>
        </div>
      </div>
      <section className="card pub-edit">
        <label htmlFor="pc-note-body" className="sr-only">気づき</label>
        <textarea id="pc-note-body" className="form-textarea note-textarea" rows={6} maxLength={NOTE_MAX} autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="気づいたこと、目に留まったもの" />
        <span className="small muted" style={{ alignSelf: "flex-end" }}>{body.length} / {NOTE_MAX}</span>
      </section>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="pc-btn primary" disabled={busy || !body.trim()} onClick={save}>書き留める</button>
      </div>
    </PcNotesLayout>
  );
}

export function PcNote() {
  const { noteId = "" } = useParams();
  const { data: note, loading } = useNote(noteId);
  const tankasById = useTankasById();
  if (loading) return <PcNotesLayout activeId={noteId}><Loading /></PcNotesLayout>;
  if (!note) return <PcNotesLayout><div className="center-msg">この気づきは見つかりません。</div></PcNotesLayout>;
  const songs = songsOf(note, tankasById).length;
  return (
    <PcNotesLayout activeId={note.id}>
      <div className="pc-titlebar">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1>気づき</h1>
          <span className="meta">{formatDate(note.createdAt)}{songs > 0 && ` · 歌にした ${songs}首`}</span>
        </div>
      </div>
      <NoteInlineEditor key={note.id} note={note} />
      <NoteRelations note={note} tankasById={tankasById} />
      <NoteHistory note={note} />
      <DetailSection title="操作">
        <div className="detail-actions">
          <Link to={`/new?note=${note.id}`} className="btn-primary">この気づきから歌を書く</Link>
        </div>
      </DetailSection>
      <NoteDeleteButton note={note} songs={songs} after="/notes" />
    </PcNotesLayout>
  );
}

/** PC版では直すのは詳細の中でするので、/notes/:id/edit は詳細に移す。 */
export function PcNoteEditRedirect() {
  const { noteId = "" } = useParams();
  return <Navigate to={`/notes/${noteId}`} replace />;
}
