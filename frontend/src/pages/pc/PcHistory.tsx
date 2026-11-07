// PC版の推敲履歴と比較。チェックボックスで2つの稿を選ぶと、その場で比べる。
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useFeedback, useRevisions, useRunsByRevision, useTanka } from "../../lib/data";
import { findingTitle, summarize } from "../../lib/findings";
import { loadSettings } from "../../lib/settings";
import { compareFindings, findingsOf } from "../../lib/timeline";
import type { Finding } from "../../lib/types";
import { PcShell } from "../../components/pc";
import { formatDate, Loading } from "../../components/ui";

const KANSUJI = ["", "一", "二", "三", "四", "五"];

export default function PcHistory() {
  const { tankaId = "" } = useParams();
  const [params] = useSearchParams();
  const { data: tanka } = useTanka(tankaId);
  const { data: revisions, loading } = useRevisions(tankaId);
  const { data: feedback } = useFeedback(tankaId);
  const runsByRev = useRunsByRevision(tankaId, revisions.map((r) => r.id));
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (picked.length === 0 && revisions.length > 0) {
      const a = params.get("a");
      const b = params.get("b");
      if (a && b) setPicked([a, b]);
      else setPicked(revisions.slice(-2).map((r) => r.id));
    }
  }, [revisions, picked.length, params]);

  if (loading) return <PcShell activeTankaId={tankaId}><Loading /></PcShell>;
  const settings = loadSettings();
  const ordered = [...revisions].reverse();
  const [left, right] = revisions.filter((r) => picked.includes(r.id)); // 古い方が左

  function toggle(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)));
  }

  const diff = left && right ? compareFindings(findingsOf(runsByRev[left.id]), findingsOf(runsByRev[right.id])) : null;
  const label = (fs: Finding[]) => (fs.length ? fs.map((f) => `${findingTitle(f)} ${f.code}`).join(" · ") : "なし");

  return (
    <PcShell activeTankaId={tankaId}>
      <div className="pc-titlebar">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1>推敲履歴</h1>
          <span className="meta">比べたい稿を2つ選んでください</span>
        </div>
        {tanka?.currentRevisionId && <Link to={`/t/${tankaId}/r/${tanka.currentRevisionId}`} className="pc-btn">チェック結果に戻る</Link>}
      </div>
      <div className="pc-history">
        <ol className="pc-rev-list">
          {ordered.map((r) => {
            const s = summarize(runsByRev[r.id] ?? [], feedback, settings);
            const checked = picked.includes(r.id);
            return (
              <li key={r.id}>
                <label className={checked ? "checked" : undefined}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(r.id)} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <Link to={`/t/${tankaId}/r/${r.id}`} style={{ fontWeight: 700, color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>第{r.revisionNo}稿</Link>
                      <span className="small muted">{formatDate(r.createdAt)}{!r.parentRevisionId && " · 初稿"}</span>
                    </span>
                    <span className="serif" style={{ fontSize: 15, lineHeight: 1.8 }}>{r.bodyNormalized}</span>
                    <span className="small muted">
                      {r.parentRevisionId ? `解消 ${s.counts.resolved} · 継続 ${s.counts.continued} · ` : ""}新規 {s.counts.new}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ol>
        <section className="card pc-compare" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }} aria-label={left && right ? `第${left.revisionNo}稿と第${right.revisionNo}稿の比較` : "比較"}>
          {!(left && right) ? (
            <p className="muted" style={{ margin: 0 }}>左の一覧から、比べる稿を2つ選んでください。</p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 40 }}>句</th>
                    <th scope="col">第{left.revisionNo}稿</th>
                    <th scope="col">第{right.revisionNo}稿</th>
                  </tr>
                </thead>
                <tbody>
                  {right.segments.map((seg) => {
                    const old = left.segments.find((x) => x.no === seg.no);
                    const same = old?.text === seg.text;
                    return (
                      <tr key={seg.no}>
                        <th scope="row" className="serif muted">{KANSUJI[seg.no]}</th>
                        <td>{same ? old?.text : <del>{old?.text}</del>}</td>
                        <td>{same ? seg.text : <ins>{seg.text}</ins>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {diff && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { l: "解消", c: "var(--accent)", fs: diff.resolved },
                    { l: "継続", c: "var(--muted)", fs: diff.continued },
                    { l: "新規", c: "var(--high)", fs: diff.added },
                  ].map((row) => (
                    <div key={row.l} style={{ display: "flex", gap: 12, fontSize: 14 }}>
                      <span style={{ width: 56, flex: "none", fontWeight: 500, color: row.c }}>{row.l} {row.fs.length}</span>
                      <span>{label(row.fs)}</span>
                    </div>
                  ))}
                </div>
              )}
              {right.note && <p className="muted" style={{ margin: 0, fontSize: 13 }}>第{right.revisionNo}稿のメモ：{right.note}</p>}
            </>
          )}
        </section>
      </div>
    </PcShell>
  );
}
