import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createTanka } from "../lib/api";
import { saveDraft } from "../lib/draft";
import { loadSettings } from "../lib/settings";
import { TopBar } from "../components/ui";
import { NoteSource } from "../components/notes";

export default function NewTankaPage() {
  const navigate = useNavigate();
  // 気づきから書くときは ?note= で受け取り、上に出す（入力欄には入れない）
  const [params] = useSearchParams();
  const noteId = params.get("note");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next() {
    setBusy(true);
    setError(null);
    try {
      const { tankaId } = await createTanka();
      const s = loadSettings();
      saveDraft({
        tankaId,
        parentRevisionId: null,
        body,
        note: "",
        style: s.defaultStyle === "auto" ? undefined : s.defaultStyle,
        orthography: s.defaultOrthography === "auto" ? undefined : s.defaultOrthography,
        sourceNoteId: noteId,
      });
      navigate(`/t/${tankaId}/reading`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar back={noteId ? `/notes/${noteId}` : "/"} backLabel={noteId ? "気づきに戻る" : "一覧に戻る"} title="新しい短歌" sub="初稿を書く" />
      <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 8 }}>
        {noteId && (
          <div style={{ padding: "0 20px" }}>
            <NoteSource noteId={noteId} onCopy={(t) => setBody(t.replace(/\s*\n\s*/g, " ").slice(0, 80))} />
          </div>
        )}
        <div className="field">
          <label htmlFor="body">本文</label>
          <textarea id="body" maxLength={80} className="textarea serif" value={body} onChange={(e) => setBody(e.target.value)} placeholder="ここに一首を書く" />
          <p className="hint">スペースや改行で句の区切りを示せます（なくても自動で分けます）</p>
          <p className="hint">文語・旧仮名の歌も書けます。次の画面で、口語か文語か、新仮名か旧仮名かを自動で判定します。違っていれば直せます。</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="footer-bar">
        <button type="button" className="btn-primary" disabled={busy || !body.trim()} onClick={next}>
          読みと句分けを確認する
        </button>
      </div>
    </>
  );
}
