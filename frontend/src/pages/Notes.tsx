// 気づき（スマホ）。書いた日時の新しい順。カードを押すと詳細へ。右下の「書き留める」ですぐ書ける
import { useState } from "react";
import { Link } from "react-router-dom";
import { LibraryTabs } from "../components/library";
import { filterNotes, NoteCard, songsOf, useTankasById } from "../components/notes";
import { Loading, PlusIcon } from "../components/ui";
import { useAuth } from "../lib/auth";
import { useNotes } from "../lib/data";
import { LibraryHeader } from "./Sequences";

export default function NotesPage() {
  const { user } = useAuth();
  const { data: notes, loading } = useNotes(user?.uid);
  const tankasById = useTankasById();
  const [q, setQ] = useState("");
  const shown = filterNotes(notes, q);
  return (
    <>
      <LibraryHeader />
      <LibraryTabs active="notes" />
      {loading ? (
        <Loading />
      ) : notes.length === 0 ? (
        <div className="empty-center" style={{ flex: "none", padding: "40px 28px" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>まだ気づきがありません</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
            ふと気づいたこと、目に留まったものを短く書き留めておけます。あとで見返して、そこから歌を書き始められます。
          </p>
        </div>
      ) : (
        <>
          <div style={{ padding: "0 16px 12px" }}>
            <input type="search" className="form-input" aria-label="気づきを検索" placeholder="本文で探す" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <p className="muted" style={{ margin: 0, padding: "0 20px 12px", fontSize: 13 }}>
            {q.trim() ? `「${q.trim()}」を含む気づき ${shown.length}件` : `${notes.length}件 · 新しい順`}
          </p>
          <div className="stack" style={{ paddingBottom: 120 }}>
            {shown.map((n) => (
              <NoteCard key={n.id} note={n} songs={songsOf(n, tankasById).length} to={`/notes/${n.id}`} />
            ))}
          </div>
        </>
      )}
      <Link to="/notes/new" className="fab">
        <PlusIcon />
        書き留める
      </Link>
    </>
  );
}
