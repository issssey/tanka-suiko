// 発表記録の詳細（スマホ）。PC版は発表記録の画面の右側で、その場で直す（pages/pc/PcPublications.tsx）。出した時点の稿と本文の写しを出す。直す・削除はここから
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deletePublication } from "../lib/api";
import { usePublication } from "../lib/data";
import { formatDay, kanjiNumber, publicationSummary } from "../lib/publishing";
import { useGoneTankas } from "../pages/Publications";
import { ConfirmDialog, Loading, TopBar } from "./ui";

export function PublicationDetail() {
  const { publicationId = "" } = useParams();
  const { data: pub, loading } = usePublication(publicationId);
  const isGone = useGoneTankas();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!pub) return <div className="center-msg">この記録は見つかりません。<Link to="/publications">発表記録へ</Link></div>;

  async function remove() {
    setBusy(true);
    try {
      await deletePublication(publicationId);
      navigate("/publications", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除できませんでした");
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const many = pub.items.length > 1;
  const body = (
    <>
      <div className="pub-detail-meta">
        <span>{formatDay(pub.submittedOn)}に出した</span>
        <span>{publicationSummary(pub)}</span>
      </div>
      {pub.note && (
        <section className="pub-detail-section">
          <h2>メモ</h2>
          <p className="pub-note" style={{ fontSize: 14 }}>{pub.note}</p>
        </section>
      )}
      <section className="pub-detail-section">
        <h2>出したもの</h2>
        <p className="hint">出した時点の稿と本文です。後で推敲しても変わりません。</p>
        <ol className="pub-items">
          {pub.items.map((it, i) => {
            const gone = isGone(it.tankaId);
            return (
              <li key={`${it.tankaId}-${i}`}>
                {many && <span className="num">{kanjiNumber(i + 1)}</span>}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <p className={gone ? "poem gone" : "poem"}>{it.body}</p>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span className="small muted">第{it.revisionNo}稿</span>
                    {gone && <span className="chip outline">削除した歌</span>}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <div className="pub-detail-actions">
        <Link to={`/publications/${pub.id}/edit`} className="btn-secondary">記録を直す</Link>
        <button type="button" className="text-btn danger" onClick={() => setConfirmDelete(true)}>この記録を削除</button>
      </div>
      <p className="hint">直せるのは出し先・出した日・メモです。出したものを間違えたときは、記録を削除して記録し直してください。</p>
      {confirmDelete && (
        <ConfirmDialog title="この記録を削除しますか？" confirmLabel="記録を削除する" busy={busy} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>短歌と連作は消えません。</p>
        </ConfirmDialog>
      )}
    </>
  );

  return (
    <>
      <TopBar back="/publications" backLabel="発表記録に戻る" title={pub.destination} sub={formatDay(pub.submittedOn)} />
      <div className="pub-detail" style={{ padding: "8px 20px 40px" }}>{body}</div>
    </>
  );
}
