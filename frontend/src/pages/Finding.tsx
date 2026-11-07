import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { putFeedback } from "../lib/api";
import { useCheckRuns, useRevision, useRevisions, useRunsByRevision } from "../lib/data";
import { CATEGORIES, findingTitle, latestDoneRun, latestRun, patternInfo, segLabel } from "../lib/findings";
import type { Finding } from "../lib/types";
import { HighlightedPoem, Loading, SeverityBadge, TopBar, TransitionBadge } from "../components/ui";

export default function FindingPage() {
  const { tankaId = "", revisionId = "", fingerprint: fpParam = "" } = useParams();
  const fingerprint = decodeURIComponent(fpParam);
  const navigate = useNavigate();
  const { data: rev } = useRevision(tankaId, revisionId);
  const { data: runs } = useCheckRuns(tankaId, revisionId);
  const { data: revisions } = useRevisions(tankaId);
  const runsByRev = useRunsByRevision(tankaId, revisions.map((r) => r.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finding = [...(latestRun(runs, "sync")?.findings ?? []), ...(latestRun(runs, "async")?.findings ?? [])].find(
    (f) => f.fingerprint === fingerprint,
  );
  if (!rev) return <Loading />;
  if (!finding) return <div className="center-msg">指摘が見つかりません。<Link to={`/t/${tankaId}/r/${revisionId}`}>戻る</Link></div>;

  const info = patternInfo(finding.code);
  // この指摘の経過：この稿までの各稿で、同じ fingerprint の指摘を探す
  const timeline: { no: number; finding: Finding }[] = [];
  for (const r of revisions) {
    if (r.revisionNo > rev.revisionNo) break;
    const rr = runsByRev[r.id] ?? [];
    const pool = [...(latestDoneRun(rr, "sync")?.findings ?? []), ...(latestDoneRun(rr, "async")?.findings ?? [])];
    const f = pool.find((x) => x.fingerprint === fingerprint);
    if (f) timeline.push({ no: r.revisionNo, finding: f });
  }

  async function judge(status: "intentional" | "false_positive") {
    setBusy(true);
    setError(null);
    try {
      await putFeedback(tankaId, fingerprint, status, revisionId);
      navigate(`/t/${tankaId}/r/${revisionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar back={`/t/${tankaId}/r/${revisionId}`} backLabel="チェック結果に戻る" title="指摘の詳細" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <SeverityBadge severity={finding.severity} />
          <span className="small muted">{finding.code} · {CATEGORIES[finding.code[0]] ?? ""}</span>
          <span style={{ marginLeft: "auto" }}><TransitionBadge transition={finding.transition} /></span>
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{findingTitle(finding)}</h1>
      </div>

      <section className="card" style={{ margin: "16px 16px 0", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="small muted" style={{ fontWeight: 500 }}>該当箇所 · {finding.segmentNo ? segLabel(finding.segmentNo) : "一首全体"}</span>
        <p className="serif" style={{ margin: 0, fontSize: 17, lineHeight: 2 }}>
          <HighlightedPoem text={rev.bodyNormalized} findings={[finding]} />
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8, padding: "22px 20px 0" }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>判定の理由</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>{finding.message}</p>
        {finding.confidence < 1 && <p className="small muted" style={{ margin: 0 }}>確からしさ {Math.round(finding.confidence * 100)}%</p>}
      </section>

      {info && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8, padding: "22px 20px 0" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>このパターンについて</h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: "var(--text-2)" }}>{info.definition}</p>
          <Link to="/patterns" style={{ fontSize: 14, fontWeight: 500 }}>ほかのパターンも見る</Link>
        </section>
      )}

      {timeline.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: "22px 20px 0" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>この指摘の経過</h2>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {timeline.map((t) => (
              <li key={t.no} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <span className="muted" style={{ width: 44 }}>第{t.no}稿</span>
                <TransitionBadge transition={t.finding.transition} />
                {t.finding.matchedText && <span className="serif">「{t.finding.matchedText}」</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      <div className="footer-bar" style={{ marginTop: 24 }}>
        <div className="row-buttons">
          <button type="button" className="btn" style={{ height: 48, fontSize: 15 }} disabled={busy} onClick={() => judge("intentional")}>意図的</button>
          <button type="button" className="btn" style={{ height: 48, fontSize: 15 }} disabled={busy} onClick={() => judge("false_positive")}>誤検出</button>
        </div>
        <span className="small muted" style={{ lineHeight: 1.6 }}>どちらにしても、この指摘を折りたたんで表示します。あとで取り消せます。</span>
      </div>
    </>
  );
}
