// 発表記録（スマホ）。出した日の新しい順。カードを押すと詳細へ
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { LibraryTabs } from "../components/library";
import { Loading, PlusIcon } from "../components/ui";
import { useAuth } from "../lib/auth";
import { usePublications, useTankas } from "../lib/data";
import { formatDay, publicationSummary } from "../lib/publishing";
import type { Publication } from "../lib/types";
import { LibraryHeader } from "./Sequences";

export default function PublicationsPage() {
  const { user } = useAuth();
  const { data: pubs, loading } = usePublications(user?.uid);
  const isGone = useGoneTankas();
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
              <PublicationCard key={p.id} pub={p} gone={p.items.length === 1 && isGone(p.items[0].tankaId)} />
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

/** 削除した歌か（一覧を読み込む前は「削除した歌」と出さない）。 */
export function useGoneTankas() {
  const { user } = useAuth();
  const { data: tankas, loading } = useTankas(user?.uid);
  const ids = useMemo(() => new Set(tankas.map((t) => t.id)), [tankas]);
  return (tankaId: string) => !loading && !ids.has(tankaId);
}

/** 発表記録のカード。出し先・本文（2行まで）・何をいつ出したか・削除した歌。 */
function PublicationCard({ pub, gone }: { pub: Publication; gone: boolean }) {
  return (
    <Link to={`/publications/${pub.id}`} className="card tanka-card compact">
      <span className="title">{pub.destination}</span>
      <p className="poem-clamp" style={gone ? { color: "var(--muted)" } : undefined}>{pub.items[0]?.body}</p>
      <span className="card-meta">{publicationSummary(pub)} · {formatDay(pub.submittedOn, "short")}</span>
      {gone && (
        <div className="chips">
          <span className="chip outline">削除した歌</span>
        </div>
      )}
    </Link>
  );
}
