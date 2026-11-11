// 気づきの詳細（スマホ）。設計書「詳細ページの構造」の順：見出しと情報 → 中身 → つながり → 履歴 → 操作 → 削除
import { Link, useParams } from "react-router-dom";
import { DetailSection } from "../components/detail";
import { NoteDeleteButton, NoteHistory, NoteRelations, songsOf, useTankasById } from "../components/notes";
import { formatDate, Loading, TopBar } from "../components/ui";
import { useNote } from "../lib/data";

export default function NotePage() {
  const { noteId = "" } = useParams();
  const { data: note, loading } = useNote(noteId);
  const tankasById = useTankasById();
  if (loading) return <Loading />;
  if (!note) return <div className="center-msg">この気づきは見つかりません。<Link to="/notes">一覧へ</Link></div>;
  const songs = songsOf(note, tankasById).length;
  return (
    <>
      <TopBar back="/notes" backLabel="気づきの一覧に戻る" title="気づき" sub={formatDate(note.createdAt)} />
      <section className="card note-detail">
        <p>{note.body}</p>
      </section>
      <NoteRelations note={note} tankasById={tankasById} />
      <NoteHistory note={note} />
      <DetailSection title="操作">
        <div className="detail-actions">
          <Link to={`/new?note=${note.id}`} className="btn-primary">この気づきから歌を書く</Link>
          <Link to={`/notes/${note.id}/edit`} className="btn-secondary">直す</Link>
        </div>
      </DetailSection>
      <NoteDeleteButton note={note} songs={songs} after="/notes" />
    </>
  );
}
