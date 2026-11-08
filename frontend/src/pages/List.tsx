import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTankas } from "../lib/data";
import type { Tanka } from "../lib/types";
import { formatDate, GearIcon, Loading, PlusIcon } from "../components/ui";
import { LibraryTabs, PublishedChips } from "../components/library";
import { LibraryHeader } from "./Sequences";

export default function ListPage() {
  const { user } = useAuth();
  const { data: tankas, loading, error } = useTankas(user?.uid);
  const withRevision = tankas.filter((t) => t.currentRevisionId);

  if (loading) return <Loading />;
  if (error) return <div className="center-msg">一覧を読み込めませんでした。</div>;
  if (withRevision.length === 0) return <EmptyState />;

  return (
    <>
      <LibraryHeader />
      <LibraryTabs active="tankas" />
      <p className="muted" style={{ margin: 0, padding: "0 20px 12px", fontSize: 13 }}>{withRevision.length}首 · 最近推敲した順</p>
      <div className="stack" style={{ paddingBottom: 120 }}>
        {withRevision.map((t) => (
          <TankaCard key={t.id} tanka={t} />
        ))}
      </div>
      <Link to="/new" className="fab">
        <PlusIcon />
        新しい短歌
      </Link>
    </>
  );
}

/** 短歌のカード。本文（2行まで）・稿と日時・発表済み／連作。 */
function TankaCard({ tanka }: { tanka: Tanka }) {
  const seqs = tanka.sequenceIds?.length ?? 0;
  return (
    <Link to={`/t/${tanka.id}/r/${tanka.currentRevisionId}`} className="card tanka-card">
      <p className="poem-clamp">{tanka.latestBody}</p>
      <span className="card-meta">第{tanka.latestRevisionNo}稿 · {formatDate(tanka.updatedAt)}</span>
      {((tanka.publishedCount ?? 0) > 0 || seqs > 0) && (
        <div className="chips">
          <PublishedChips tanka={tanka} />
        </div>
      )}
    </Link>
  );
}

function EmptyState() {
  return (
    <>
      <header className="page-header">
        <h1 className="brand">推敲帖</h1>
        <Link to="/settings" className="icon-btn" aria-label="設定" style={{ color: "var(--muted)" }}>
          <GearIcon />
        </Link>
      </header>
      <div className="empty-center">
        <h2 style={{ margin: 0, fontSize: 20 }}>まだ短歌がありません</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
          一首を書いて保存するたびに、つまずきを指摘します。推敲を重ねると、どの指摘が解消したかが分かります。
        </p>
        <ol className="steps">
          <li><span className="num">1</span><div><div style={{ fontWeight: 700 }}>歌を書く</div><div className="small muted">一行でも、句ごとに区切っても構いません</div></div></li>
          <li><span className="num">2</span><div><div style={{ fontWeight: 700 }}>読みを確かめる</div><div className="small muted">自動で付けた読みと句の区切りを直せます</div></div></li>
          <li><span className="num">3</span><div><div style={{ fontWeight: 700 }}>指摘を見て、推敲する</div><div className="small muted">直すかどうかはあなたが決めます</div></div></li>
        </ol>
      </div>
      <div style={{ padding: "16px 20px 32px" }}>
        <Link to="/new" className="btn-primary">最初の一首を書く</Link>
      </div>
    </>
  );
}
