// PC版の発表記録。表で、出した日の新しい順
import { Link } from "react-router-dom";
import { PcHeader } from "../../components/pc";
import { LibraryTabs } from "../../components/library";
import { Loading, PlusIcon } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { usePublications } from "../../lib/data";
import { publicationSummary } from "../../lib/publishing";
import { usePublicationLinks } from "../Publications";

export default function PcPublications() {
  const { user } = useAuth();
  const { data: pubs, loading } = usePublications(user?.uid);
  const links = usePublicationLinks();
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
                  <th scope="col"><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {pubs.map((p) => {
                  const link = links(p);
                  const poem = (
                    <span className="serif" style={{ fontSize: 15, lineHeight: 1.8, color: link.gone ? "var(--muted)" : "var(--text)" }}>
                      {p.items[0]?.body}
                      {p.items.length > 1 && `　ほか${p.items.length - 1}首`}
                    </span>
                  );
                  return (
                    <tr key={p.id}>
                      <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{p.submittedOn}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{p.destination}</td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span className="small muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            {publicationSummary(p)}
                            {link.gone && <span className="chip neutral">削除した歌</span>}
                          </span>
                          {link.to ? <Link to={link.to} style={{ textDecoration: "none" }}>{poem}</Link> : poem}
                        </div>
                      </td>
                      <td style={{ fontSize: 13, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{p.note}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link to={`/publications/${p.id}/edit`} className="small-btn" aria-label={`${p.destination}の記録を直す`}>直す</Link>
                      </td>
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
