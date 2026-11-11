// 気づきを書き留める・直す（スマホ）。大きな入力欄と保存だけ。
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { NOTE_MAX } from "../components/notes";
import { Loading, TopBar } from "../components/ui";
import { createNote, updateNote } from "../lib/api";
import { useNote } from "../lib/data";

export default function NoteWritePage() {
  const { noteId } = useParams();
  const editing = Boolean(noteId);
  const { data: note, loading } = useNote(noteId);
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (note) setBody(note.body);
  }, [note]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editing && noteId) {
        await updateNote(noteId, body);
        navigate(`/notes/${noteId}`, { replace: true });
      } else {
        await createNote(body);
        navigate("/notes", { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
      setBusy(false);
    }
  }

  if (editing && loading) return <Loading />;
  const back = editing ? `/notes/${noteId}` : "/notes";
  return (
    <>
      <TopBar back={back} backLabel={editing ? "気づきに戻る" : "気づきの一覧に戻る"} title={editing ? "気づきを直す" : "気づきを書き留める"} />
      <div className="field" style={{ paddingTop: 8 }}>
        <label htmlFor="note-body" className="sr-only">気づき</label>
        <textarea
          id="note-body"
          className="form-textarea note-textarea"
          rows={8}
          maxLength={NOTE_MAX}
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="気づいたこと、目に留まったもの"
        />
        <p className="hint" style={{ textAlign: "right" }}>{body.length} / {NOTE_MAX}</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="footer-bar">
        <button type="button" className="btn-primary" disabled={busy || !body.trim()} onClick={save}>
          {editing ? "保存する" : "書き留める"}
        </button>
      </div>
    </>
  );
}
