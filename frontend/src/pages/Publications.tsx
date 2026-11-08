// 発表記録（スマホ）。出した日の新しい順
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { LibraryTabs } from "../components/library";
import { Loading, PlusIcon } from "../components/ui";
import { useAuth } from "../lib/auth";
import { usePublications, useSequences, useTankas } from "../lib/data";
import { formatDay, publicationSummary } from "../lib/publishing";
import type { Publication } from "../lib/types";
import { LibraryHeader } from "./Sequences";

export default function PublicationsPage() {
  const { user } = useAuth();
  const { data: pubs, loading } = usePublications(user?.uid);
  const links = usePublicationLinks();
  return (
    <>
      <LibraryHeader />
      <LibraryTabs active="publications" />
      {loading ? (
        <Loading />
      ) : pubs.length === 0 ? (
        <div className="empty-center" style={{ flex: "none", padding: "40px 28px" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>まだ発表の記録がありません</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
            歌壇や賞、SNS などに出したら、どの稿をどこにいつ出したかを残しておけます。同じ歌を出そうとすると知らせます。
          </p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, padding: "0 20px 12px", fontSize: 13 }}>{pubs.length}件 · 出した日の新しい順</p>
          <div className="stack" style={{ paddingBottom: 120 }}>
            {pubs.map((p) => (
              <PublicationCard key={p.id} pub={p} link={links(p)} />
            ))}
          </div>
        </>
      )}
      <Link to="/publish" className="fab">
        <PlusIcon />
        発表を記録
      </Link>
    </>
  );
}

/** 記録から飛べる先（1首なら出した稿の結果、連作ならその連作）。削除した歌・連作には飛ばない。 */
export function usePublicationLinks() {
  const { user } = useAuth();
  const { data: tankas, loading } = useTankas(user?.uid);
  const { data: sequences } = useSequences(user?.uid);
  const tankaIds = useMemo(() => new Set(tankas.map((t) => t.id)), [tankas]);
  const seqIds = useMemo(() => new Set(sequences.map((s) => s.id)), [sequences]);
  return (p: Publication): { to: string | null; gone: boolean } => {
    if (p.sequenceId) return { to: seqIds.has(p.sequenceId) ? `/sequences/${p.sequenceId}` : null, gone: false };
    const first = p.items[0];
    const alive = Boolean(first && tankaIds.has(first.tankaId));
    // 一覧を読み込む前は「削除した歌」と出さない
    return { to: alive ? `/t/${first.tankaId}/r/${first.revisionId}` : null, gone: !loading && p.items.length === 1 && !alive };
  };
}

function PublicationCard({ pub, link }: { pub: Publication; link: { to: string | null; gone: boolean } }) {
  const first = pub.items[0];
  const poem = (
    <p className={link.gone ? "poem gone" : "poem"}>
      {first?.body}
      {pub.items.length > 1 && <span className="small muted" style={{ fontFamily: "var(--sans)" }}>　ほか{pub.items.length - 1}首</span>}
    </p>
  );
  return (
    <article className="pub-card">
      <div className="head">
        <span className="dest">{pub.destination}</span>
        <Link to={`/publications/${pub.id}/edit`} className="small-btn" style={{ marginLeft: "auto" }} aria-label={`${pub.destination}の記録を直す`}>直す</Link>
      </div>
      <div className="meta">
        <span>{formatDay(pub.submittedOn)}</span>
        <span aria-hidden="true">·</span>
        <span>{publicationSummary(pub)}</span>
        {link.gone && <span className="chip neutral">削除した歌</span>}
      </div>
      {link.to ? <Link to={link.to} style={{ textDecoration: "none", color: "inherit" }}>{poem}</Link> : poem}
      {pub.note && <p className="pub-note">{pub.note}</p>}
    </article>
  );
}
