import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useCheckRuns, useFeedback, useTankas } from "../../lib/data";
import { severityCounts, summarize } from "../../lib/findings";
import { loadSettings } from "../../lib/settings";
import type { Tanka } from "../../lib/types";
import { PcHeader } from "../../components/pc";
import { formatDate, Loading, PlusIcon } from "../../components/ui";
import { LibraryTabs, PublishedChips } from "../../components/library";

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5F5B53" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export default function PcHome() {
  const { user } = useAuth();
  const { data: tankas, loading } = useTankas(user?.uid);
  const [q, setQ] = useState("");
  const list = tankas.filter((t) => t.currentRevisionId);
  const shown = q.trim() ? list.filter((t) => (t.latestBody ?? "").includes(q.trim())) : list;

  return (
    <div className="pc">
      <PcHeader />
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <PcEmpty />
      ) : (
        <main className="pc-home">
          <div className="pc-titlebar">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h1 style={{ fontSize: 26 }}>短歌</h1>
              <span className="meta">{list.length}首 · 最近推敲した順</span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label className="pc-search">
                <SearchIcon />
                <span className="sr-only">短歌を検索</span>
                <input type="search" placeholder="本文で探す" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <Link to="/new" className="pc-btn primary" style={{ height: 44, padding: "0 18px" }}>
                <PlusIcon />
                新しい短歌
              </Link>
            </div>
          </div>
          <LibraryTabs active="tankas" pc />
          {shown.length === 0 && <p className="muted">「{q}」を含む短歌はありません。</p>}
          <div className="pc-grid">
            {shown.map((t) => (
              <PcCard key={t.id} tanka={t} />
            ))}
          </div>
        </main>
      )}
    </div>
  );
}

function PcCard({ tanka }: { tanka: Tanka }) {
  const { data: runs } = useCheckRuns(tanka.id, tanka.currentRevisionId);
  const { data: feedback } = useFeedback(tanka.id);
  const s = summarize(runs, feedback, loadSettings());
  const c = severityCounts(s.visible);
  return (
    <Link to={`/t/${tanka.id}/r/${tanka.currentRevisionId}`} className="card tanka-card">
      <span className="small muted">第{tanka.latestRevisionNo}稿 · {formatDate(tanka.updatedAt)}</span>
      <p className="poem-line">{tanka.latestBody}</p>
      <div className="chips" style={{ marginTop: "auto" }}>
        {c.high > 0 && <span className="chip high">高 {c.high}</span>}
        {c.medium > 0 && <span className="chip medium">中 {c.medium}</span>}
        {c.low > 0 && <span className="chip low">低 {c.low}</span>}
        {s.hidden.length > 0 && <span className="chip neutral">非表示 {s.hidden.length}</span>}
        {s.counts.resolved > 0 && <span className="chip accent">前稿から {s.counts.resolved}件解消</span>}
        {s.asyncPending && <span className="chip neutral">意味のチェック中</span>}
        <PublishedChips tanka={tanka} />
      </div>
    </Link>
  );
}

function PcEmpty() {
  return (
    <div className="pc-center">
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>まだ短歌がありません</h1>
          <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.8 }}>
            一首を書いて保存するたびに、つまずきを指摘します。推敲を重ねると、どの指摘が解消したかが分かります。
          </p>
        </div>
        <ol className="steps">
          <li><span className="num">1</span><div><div style={{ fontWeight: 700 }}>歌を書く</div><div className="small muted">一行でも、句ごとに区切っても構いません。文語・旧仮名の歌も書けます。</div></div></li>
          <li><span className="num">2</span><div><div style={{ fontWeight: 700 }}>読みを確かめる</div><div className="small muted">書きながら、右側に読みと句の区切り、モーラ数が出ます。違っていれば直せます。</div></div></li>
          <li><span className="num">3</span><div><div style={{ fontWeight: 700 }}>指摘を見て、推敲する</div><div className="small muted">直すかどうかはあなたが決めます。意図的なものは「意図的」にしておけます。</div></div></li>
        </ol>
        <Link to="/new" className="btn-primary" style={{ maxWidth: 320 }}>
          <PlusIcon />
          最初の一首を書く
        </Link>
      </div>
    </div>
  );
}
