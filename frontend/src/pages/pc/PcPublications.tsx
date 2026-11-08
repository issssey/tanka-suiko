// PC版の発表記録。表で、出した日の新しい順。行を押すと詳細へ
import { Link, useNavigate } from "react-router-dom";
import { PcHeader } from "../../components/pc";
import { LibraryTabs } from "../../components/library";
import { Loading, PlusIcon } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { usePublications } from "../../lib/data";
import { publicationSummary } from "../../lib/publishing";
import { useGoneTankas } from "../Publications";

export default function PcPublications() {
  const { user } = useAuth();
  const { data: pubs, loading } = usePublications(user?.uid);
  const isGone = useGoneTankas();
  const navigate = useNavigate();
  return (
    <div className="pc">
      <PcHeader />
      <main className="pc-home" style={{ gap: 20 }}>
        <div className="pc-titlebar">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h1 style={{ fontSize: 26 }}>発表記録</h1>
            <span className="meta">{pubs.length}件 · 出した日の新しい順</span>
          </div>
          <Link to="/publish" className="pc-btn primary" style={{ height: 44, padding: "0 18px" }}>
            <PlusIcon />
            発表を記録
          </Link>
        </div>
        <LibraryTabs active="publications" pc />
        {loading ? (
          <Loading />
        ) : pubs.length === 0 ? (
          <p className="muted" style={{ lineHeight: 1.8 }}>
            まだ発表の記録がありません。歌壇や賞、SNS などに出したら、どの稿をどこにいつ出したかを残しておけます。同じ歌を出そうとすると知らせます。
          </p>
        ) : (
          <div className="pc-table-wrap">
            <table className="pc-table">
              <thead>
                <tr>
                  <th scope="col">出した日</th>
                  <th scope="col">出し先</th>
                  <th scope="col">出したもの</th>
                  <th scope="col">メモ</th>
                </tr>
              </thead>
              <tbody>
                {pubs.map((p) => {
                  const gone = p.items.length === 1 && isGone(p.items[0].tankaId);
                  return (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/publications/${p.id}`)}>
                      <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{p.submittedOn}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>
                        {/* キーボードでも詳細に移れるよう、出し先をリンクにする */}
                        <Link to={`/publications/${p.id}`} style={{ color: "var(--text)", textDecoration: "none" }}>{p.destination}</Link>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span className="small muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            {publicationSummary(p)}
                            {gone && <span className="chip neutral">削除した歌</span>}
                          </span>
                          <span className="serif" style={{ fontSize: 15, lineHeight: 1.8, color: gone ? "var(--muted)" : "var(--text)" }}>
                            {p.items[0]?.body}
                            {p.items.length > 1 && `　ほか${p.items.length - 1}首`}
                          </span>
                        </div>
                      </td>
                      <td style={{ fontSize: 13, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{p.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
