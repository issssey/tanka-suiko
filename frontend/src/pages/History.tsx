import { Link, useParams } from "react-router-dom";
import { useFeedback, useRevisions, useRunsByRevision, useTanka } from "../lib/data";
import { markSpans, summarize } from "../lib/findings";
import { loadSettings } from "../lib/settings";
import type { Revision } from "../lib/types";
import { formatDate, Loading, TopBar } from "../components/ui";

/** 親の版と比べて変わった文字に印を付ける（句ごとに比べる）。 */
function changedSpans(rev: Revision, parent: Revision | undefined): [number, number][] {
  if (!parent) return [];
  return rev.segments.filter((s) => parent.segments.find((p) => p.no === s.no)?.text !== s.text).map((s) => s.span);
}

export default function HistoryPage() {
  const { tankaId = "" } = useParams();
  const { data: tanka } = useTanka(tankaId);
  const { data: revisions, loading } = useRevisions(tankaId);
  const { data: feedback } = useFeedback(tankaId);
  const runsByRev = useRunsByRevision(tankaId, revisions.map((r) => r.id));
  const settings = loadSettings();

  if (loading) return <Loading />;
  const latest = revisions[revisions.length - 1];
  const ordered = [...revisions].reverse();
  const byId = new Map(revisions.map((r) => [r.id, r]));

  return (
    <>
      <TopBar
        back={latest ? `/t/${tankaId}/r/${latest.id}` : "/"}
        backLabel="チェック結果に戻る"
        title="推敲履歴"
        sub={`${tanka?.title || "無題"} · ${revisions.length}稿`}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 20px 12px", gap: 12 }}>
        <span className="small muted"><span className="hl-low">下線</span>は前の稿から変わった句</span>
        {revisions.length >= 2 && (
          <Link to={`/t/${tankaId}/compare`} className="small" style={{ fontWeight: 500 }}>2つの稿を比べる</Link>
        )}
      </div>
      <ol className="stack" style={{ listStyle: "none", margin: 0, paddingBottom: 32 }}>
        {ordered.map((r) => {
          const s = summarize(runsByRev[r.id] ?? [], feedback, settings);
          const parent = r.parentRevisionId ? byId.get(r.parentRevisionId) : undefined;
          const marks = changedSpans(r, parent);
          return (
            <li key={r.id}>
              <Link to={`/t/${tankaId}/r/${r.id}`} className="card tanka-card">
                <div className="head">
                  <span style={{ fontSize: 15, fontWeight: 700 }}>
                    第{r.revisionNo}稿
                    {r.id === tanka?.currentRevisionId && <span className="chip accent" style={{ marginLeft: 8 }}>いまの稿</span>}
                    {!parent && <span className="chip neutral" style={{ marginLeft: 8 }}>初稿</span>}
                  </span>
                  <span className="small muted">{formatDate(r.createdAt)}</span>
                </div>
                <p className="poem-line">
                  {markSpans(r.bodyNormalized, marks).map((p, i) => (
                    <span key={i} className={p.marked ? "hl-low" : undefined}>{p.text}</span>
                  ))}
                </p>
                {r.note && <span className="small muted">メモ：{r.note}</span>}
                <div className="chips">
                  {parent && <span className="chip accent">解消 {s.counts.resolved}</span>}
                  {parent && <span className="chip neutral">継続 {s.counts.continued}</span>}
                  <span className="chip high">新規 {s.counts.new}</span>
                  {s.asyncPending && <span className="chip neutral">判定中</span>}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </>
  );
}
