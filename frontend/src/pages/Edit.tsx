import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useRevision, useTanka } from "../lib/data";
import { loadDraft, saveDraft } from "../lib/draft";
import { Loading, TopBar } from "../components/ui";

export default function EditPage() {
  const { tankaId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: tanka, loading } = useTanka(tankaId);
  const parentId = params.get("from") ?? tanka?.currentRevisionId ?? null;
  const { data: parent } = useRevision(tankaId, parentId);
  const [body, setBody] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (body !== null || !parent) return;
    const draft = loadDraft(tankaId);
    if (draft && draft.parentRevisionId === parent.id) {
      setBody(draft.body);
      setNote(draft.note);
    } else {
      setBody(parent.segments.map((s) => s.text).join(" "));
    }
  }, [parent, body, tankaId]);

  if (loading || !tanka) return <Loading />;
  const nextNo = tanka.nextRevisionNo;

  function next() {
    if (!parent || body === null) return;
    saveDraft({ tankaId, parentRevisionId: parent.id, body, note, style: parent.style, orthography: parent.orthography });
    navigate(`/t/${tankaId}/reading`);
  }

  return (
    <>
      <TopBar back={parent ? `/t/${tankaId}/r/${parent.id}` : "/"} backLabel="チェック結果に戻る" title={tanka.title || "無題"} sub={`第${nextNo}稿を書く`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 8 }}>
        {parent && (
          <section className="card" style={{ margin: "0 16px", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="small muted" style={{ fontWeight: 500 }}>前の稿（第{parent.revisionNo}稿）</span>
            <p className="serif" style={{ margin: 0, fontSize: 15, lineHeight: 1.9, color: "var(--text-2)" }}>{parent.bodyNormalized}</p>
          </section>
        )}
        <div className="field">
          <label htmlFor="body">本文</label>
          <textarea id="body" className="textarea serif" value={body ?? ""} onChange={(e) => setBody(e.target.value)} />
          <p className="hint">スペースや改行で句の区切りを示せます（なくても自動で分けます）</p>
        </div>
        <div className="field">
          <label htmlFor="note">推敲メモ <span style={{ fontWeight: 400 }}>（任意）</span></label>
          <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：涙の描写をやめて、行動で見せる" />
        </div>
      </div>
      <div className="footer-bar">
        <button type="button" className="btn-primary" disabled={!parent || !body?.trim()} onClick={next}>
          読みと句分けを確認する
        </button>
      </div>
    </>
  );
}
