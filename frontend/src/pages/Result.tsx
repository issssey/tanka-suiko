import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { putFeedback, recheck } from "../lib/api";
import { useCheckRuns, useFeedback, useRevision, useTanka } from "../lib/data";
import { findingTitle, resolvedDetails, summarize } from "../lib/findings";
import { loadSettings } from "../lib/settings";
import { CheckIcon, ClockIcon, FindingCard, formatDate, HighlightedPoem, Loading, TopBar } from "../components/ui";
import type { CheckRun } from "../lib/types";

export default function ResultPage() {
  const { tankaId = "", revisionId = "" } = useParams();
  const { data: tanka } = useTanka(tankaId);
  const { data: rev, loading } = useRevision(tankaId, revisionId);
  const { data: runs } = useCheckRuns(tankaId, revisionId);
  const { data: parentRuns } = useCheckRuns(tankaId, rev?.parentRevisionId);
  const { data: feedback } = useFeedback(tankaId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!rev) return <div className="center-msg">この稿は見つかりません。<Link to="/">一覧へ</Link></div>;

  const s = summarize(runs, feedback, loadSettings());
  const resolved = resolvedDetails(s.resolved, parentRuns);
  const syncFindings = s.visible.filter((f) => s.sync?.findings.some((x) => x.fingerprint === f.fingerprint));
  const isLatest = tanka?.currentRevisionId === rev.id;
  const intentional = s.hidden.filter((h) => h.feedback.status === "intentional").length;

  async function judge(fingerprint: string, status: "intentional" | "false_positive") {
    setBusy(fingerprint);
    setError(null);
    try {
      await putFeedback(tankaId, fingerprint, status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(null);
    }
  }

  async function runAgain() {
    setBusy("recheck");
    try {
      await recheck(tankaId, rev!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "再チェックできませんでした");
    } finally {
      setBusy(null);
    }
  }

  const card = (f: (typeof s.visible)[number]) => (
    <FindingCard
      key={f.fingerprint}
      finding={f}
      detailHref={`/t/${tankaId}/r/${rev.id}/f/${encodeURIComponent(f.fingerprint)}`}
      onJudge={(st) => judge(f.fingerprint, st)}
      busy={busy === f.fingerprint}
    />
  );

  return (
    <>
      <TopBar
        back="/"
        backLabel="一覧に戻る"
        title={tanka?.title || "無題"}
        sub={`第${rev.revisionNo}稿 · ${formatDate(rev.createdAt)}`}
        right={
          <Link to={`/t/${tankaId}/history`} className="text-link-btn">
            <ClockIcon />
            履歴
          </Link>
        }
      />

      <section className="card poem-box">
        <p>
          <HighlightedPoem text={rev.bodyNormalized} findings={s.visible} />
        </p>
      </section>

      {rev.parentRevisionId && (
        <div className="tally">
          <div className="resolved"><span className="n">{s.counts.resolved}</span><span className="l">解消</span></div>
          <div className="continued"><span className="n">{s.counts.continued}</span><span className="l">継続</span></div>
          <div className="new"><span className="n">{s.counts.new}</span><span className="l">新規</span></div>
        </div>
      )}

      <AsyncStatus run={s.async} onRecheck={runAgain} busy={busy === "recheck"} />
      {error && <p className="error">{error}</p>}

      {s.asyncPending ? (
        <>
          <h2 className="section-title">定型のチェック {syncFindings.length}件</h2>
          <p className="small muted" style={{ margin: "-6px 20px 10px" }}>保存と同時に確認できるもの</p>
          <div className="stack">{syncFindings.map(card)}</div>
          <h2 className="section-title">意味のチェック</h2>
          <div className="card" style={{ margin: "0 16px", padding: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <span className="spinner" aria-hidden="true" />
            <span className="small muted">判定中です。終わったらここに追加されます。</span>
          </div>
        </>
      ) : (
        <>
          <h2 className="section-title">指摘 {s.visible.length}件</h2>
          <div className="stack">
            {s.visible.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14, padding: "0 4px" }}>表示する指摘はありません。</p>}
            {s.visible.map(card)}
          </div>
        </>
      )}

      {resolved.length > 0 && (
        <>
          <h2 className="section-title">
            前の稿から解消 {resolved.length}件{s.asyncPending && <span className="small muted" style={{ fontWeight: 400 }}>（判定中の分を除く）</span>}
          </h2>
          <ul className="card list">
            {resolved.map((f) => (
              <li key={f.fingerprint}>
                <CheckIcon />
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {findingTitle(f)} <span className="small muted" style={{ fontWeight: 400 }}>{f.code}</span>
                  </span>
                  {f.matchedText && <span className="small muted">{f.matchedText}</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {s.hidden.length > 0 && (
        <Link to={`/t/${tankaId}/hidden`} className="dashed-link">
          非表示にした指摘 {s.hidden.length}件（意図的 {intentional} · 誤検出 {s.hidden.length - intentional}）<span aria-hidden="true">›</span>
        </Link>
      )}
      {s.filtered.length > 0 && (
        <p className="small muted" style={{ margin: "12px 20px 0" }}>
          表示の設定で {s.filtered.length}件を省いています。<Link to="/settings">設定</Link>
        </p>
      )}

      <div className="footer-bar" style={{ marginTop: 24 }}>
        <Link to={`/t/${tankaId}/edit?from=${rev.id}`} className="btn-primary">
          この稿から推敲する
        </Link>
        {!isLatest && <span className="small muted" style={{ textAlign: "center" }}>この稿は最新ではありません。ここから枝分かれして推敲できます。</span>}
      </div>
    </>
  );
}

function AsyncStatus({ run, onRecheck, busy }: { run?: CheckRun; onRecheck: () => void; busy: boolean }) {
  if (!run) return null;
  const text: Record<CheckRun["status"], string> = {
    queued: "意味のチェックを実行中です。通常30秒ほどで終わります。画面を離れても結果は保存されます。",
    running: "意味のチェックを実行中です。通常30秒ほどで終わります。画面を離れても結果は保存されます。",
    done: "定型のチェックと意味のチェックが完了しました",
    skipped: "続けて保存されたため、この稿の意味のチェックは省きました",
    limited: "今日の意味のチェックの上限に達しました。定型のチェックの結果だけを表示しています",
    failed: "意味のチェックに失敗しました",
  };
  const pending = run.status === "queued" || run.status === "running";
  return (
    <div className="status-line" role="status">
      {pending ? <span className="spinner" aria-hidden="true" /> : run.status === "done" ? <CheckIcon size={16} /> : null}
      <span style={{ flex: 1 }}>{text[run.status]}</span>
      {(run.status === "failed" || run.status === "skipped") && (
        <button type="button" className="pill" disabled={busy} onClick={onRecheck}>
          再チェック
        </button>
      )}
    </div>
  );
}
