import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCheckRuns, useFeedback, useTankas } from "../lib/data";
import { severityCounts, summarize } from "../lib/findings";
import { loadSettings } from "../lib/settings";
import type { Tanka } from "../lib/types";
import { formatDate, GearIcon, Loading, PlusIcon } from "../components/ui";

export default function ListPage() {
  const { user } = useAuth();
  const { data: tankas, loading, error } = useTankas(user?.uid);
  const withRevision = tankas.filter((t) => t.currentRevisionId);

  if (loading) return <Loading />;
  if (error) return <div className="center-msg">一覧を読み込めませんでした。</div>;
  if (withRevision.length === 0) return <EmptyState />;

  return (
    <>
      <header className="page-header">
        <h1 className="brand">推敲帖</h1>
        <Link to="/settings" className="icon-btn" aria-label="設定" style={{ color: "var(--muted)" }}>
          <GearIcon />
        </Link>
      </header>
      <p className="muted" style={{ margin: 0, padding: "0 20px 16px", fontSize: 13 }}>{withRevision.length}首 · 最近推敲した順</p>
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

function TankaCard({ tanka }: { tanka: Tanka }) {
  const { data: runs } = useCheckRuns(tanka.id, tanka.currentRevisionId);
  const { data: feedback } = useFeedback(tanka.id);
  const s = summarize(runs, feedback, loadSettings());
  const c = severityCounts(s.visible);
  const href = `/t/${tanka.id}/r/${tanka.currentRevisionId}`;
  return (
    <Link to={href} className="card tanka-card">
      <span className="small muted">
        第{tanka.latestRevisionNo}稿 · {formatDate(tanka.updatedAt)}
      </span>
      <p className="poem-line">{tanka.latestBody}</p>
      <div className="chips">
        {c.high > 0 && <span className="chip high">高 {c.high}</span>}
        {c.medium > 0 && <span className="chip medium">中 {c.medium}</span>}
        {c.low > 0 && <span className="chip low">低 {c.low}</span>}
        {s.hidden.length > 0 && <span className="chip neutral">非表示 {s.hidden.length}</span>}
        {s.counts.resolved > 0 && <span className="chip accent">前稿から {s.counts.resolved}件解消</span>}
        {s.asyncPending && <span className="chip neutral">意味のチェック中</span>}
      </div>
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
