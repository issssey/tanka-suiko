// PC版のチェック結果。右の列に、指摘の一覧・指摘の詳細・非表示にした指摘を切り替えて出す。
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useRevisionActions } from "../../lib/actions";
import { useCheckRuns, useFeedback, useRevision, useRevisions, useRunsByRevision, useTanka } from "../../lib/data";
import { CATEGORIES, findingTitle, latestRun, patternInfo, resolvedDetails, segLabel, summarize } from "../../lib/findings";
import { loadSettings } from "../../lib/settings";
import { findingsOf, findingTimeline } from "../../lib/timeline";
import type { CheckRun, Finding } from "../../lib/types";
import { PcShell, PcTally, VerticalPoem } from "../../components/pc";
import { BackIcon, CheckIcon, ConfirmDialog, formatDate, Loading, SeverityBadge, TransitionBadge, TrashIcon } from "../../components/ui";

type Mode = "list" | "finding" | "hidden";

export default function PcResult({ mode, revisionIdOverride }: { mode: Mode; revisionIdOverride?: string }) {
  const params = useParams();
  const { tankaId = "", fingerprint: fpParam } = params;
  const revisionId = revisionIdOverride ?? params.revisionId ?? "";
  const fingerprint = fpParam ? decodeURIComponent(fpParam) : null;
  const { data: tanka } = useTanka(tankaId);
  const { data: rev, loading } = useRevision(tankaId, revisionId);
  const { data: runs } = useCheckRuns(tankaId, revisionId);
  const { data: parentRuns } = useCheckRuns(tankaId, rev?.parentRevisionId);
  const { data: feedback } = useFeedback(tankaId);
  const { data: revisions } = useRevisions(tankaId);
  const runsByRev = useRunsByRevision(tankaId, revisions.map((r) => r.id));
  const actions = useRevisionActions(tankaId, revisionId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  if (loading) return <PcShell activeTankaId={tankaId}><Loading /></PcShell>;
  if (!rev) return <PcShell activeTankaId={tankaId}><div className="center-msg">この稿は見つかりません。<Link to="/">一覧へ</Link></div></PcShell>;

  const s = summarize(runs, feedback, loadSettings());
  const resolved = resolvedDetails(s.resolved, parentRuns);
  const base = `/t/${tankaId}/r/${rev.id}`;
  const revisionCount = tanka?.latestRevisionNo ?? rev.revisionNo;
  const timeline = (fp: string) => findingTimeline(revisions, runsByRev, fp, rev.revisionNo);
  const current = selected ?? s.visible[0]?.fingerprint ?? null;

  let aside;
  if (mode === "finding" && fingerprint) {
    const f = [...(latestRun(runs, "sync")?.findings ?? []), ...(latestRun(runs, "async")?.findings ?? [])].find((x) => x.fingerprint === fingerprint);
    aside = <FindingDetail base={base} finding={f} timeline={f ? timeline(f.fingerprint) : []} actions={actions} />;
  } else if (mode === "hidden") {
    aside = <HiddenList base={base} feedback={feedback} lookup={(fp) => lookupFinding(revisions.map((r) => r.id), runsByRev, fp)} actions={actions} />;
  } else {
    aside = (
      <>
        {s.asyncPending ? (
          <div className="progress-banner" role="status" style={{ margin: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="spinner" aria-hidden="true" />
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--accent-hover)" }}>意味のチェックを実行中</span>
            </div>
            <div className="progress-track" aria-hidden="true" />
            <span style={{ fontSize: 12, lineHeight: 1.6, color: "#3D4F6E" }}>通常30秒ほどで終わります。ほかの画面に移っても結果は保存されます。</span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h2>指摘 {s.visible.length}件</h2>
            <AsyncState run={s.async} stalled={s.asyncStalled} onRecheck={actions.recheck} busy={actions.busy === "recheck"} />
          </div>
        )}
        {actions.error && <p className="error" style={{ margin: 0 }}>{actions.error}</p>}
        {s.asyncPending && <h2>定型のチェック {s.visible.length}件</h2>}
        {s.visible.length === 0 && !s.asyncPending && <p className="muted" style={{ margin: 0, fontSize: 14 }}>表示する指摘はありません。</p>}
        {s.visible.map((f) => (
          <PcFindingCard
            key={f.fingerprint}
            finding={f}
            expanded={f.fingerprint === current}
            onSelect={() => setSelected(f.fingerprint)}
            detailHref={`${base}/f/${encodeURIComponent(f.fingerprint)}`}
            timeline={timeline(f.fingerprint)}
            onJudge={(st) => actions.judge(f.fingerprint, st)}
            busy={actions.busy === f.fingerprint}
          />
        ))}
        {s.asyncPending && (
          <>
            <h2>意味のチェック</h2>
            <div className="skeleton" aria-hidden="true"><div className="bar head" style={{ width: "40%" }} /><div className="bar" style={{ width: "85%" }} /><div className="bar" style={{ width: "60%" }} /></div>
            <div className="skeleton" aria-hidden="true"><div className="bar head" style={{ width: "30%" }} /><div className="bar" style={{ width: "75%" }} /></div>
          </>
        )}
        {resolved.length > 0 && (
          <>
            <h3>前の稿から解消 {resolved.length}件{s.asyncPending && <span className="small muted" style={{ fontWeight: 400 }}>（判定中の分を除く）</span>}</h3>
            <ul className="pc-resolved">
              {resolved.map((f) => (
                <li key={f.fingerprint}>
                  <CheckIcon size={16} />
                  {findingTitle(f)} {f.code}
                  {f.matchedText && <span className="muted">{f.matchedText}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {s.hidden.length > 0 && (
          <Link to={`/t/${tankaId}/hidden?r=${rev.id}`} className="dashed-link" style={{ margin: "6px 0 0", minHeight: 44, fontSize: 13 }}>
            非表示にした指摘 {s.hidden.length}件<span aria-hidden="true">›</span>
          </Link>
        )}
        {s.filtered.length > 0 && (
          <p className="small muted" style={{ margin: 0 }}>表示の設定で {s.filtered.length}件を省いています。<Link to="/settings#display">設定</Link></p>
        )}
      </>
    );
  }

  const highlight = mode === "finding" && fingerprint ? s.visible.filter((f) => f.fingerprint === fingerprint) : s.visible;

  return (
    <PcShell activeTankaId={tankaId} aside={aside} asideLabel="指摘">
      <div className="pc-titlebar">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1>第{rev.revisionNo}稿</h1>
          <span className="meta">
            {formatDate(rev.createdAt)}
            {rev.note && ` · メモ：${rev.note}`}
          </span>
        </div>
        <div className="pc-actions">
          {mode === "list" && (
            <button type="button" className="pc-btn danger" onClick={() => setConfirmDelete(true)}>
              <TrashIcon />
              削除
            </button>
          )}
          <Link to={`/t/${tankaId}/history`} className="pc-btn">履歴と比較</Link>
          <Link to={`/t/${tankaId}/edit?from=${rev.id}`} className="pc-btn primary">この稿から推敲する</Link>
        </div>
      </div>
      <VerticalPoem text={rev.bodyNormalized} segments={rev.segments} findings={highlight} />
      {rev.parentRevisionId &&
        (s.asyncPending ? (
          <div className="muted" style={{ fontSize: 14 }}>
            前の稿から 解消 {s.counts.resolved} · 新規 {s.counts.new}
            <span className="small">（意味のチェックが終わると更新されます）</span>
          </div>
        ) : (
          <PcTally counts={s.counts} />
        ))}
      {confirmDelete && (
        <ConfirmDialog
          title="この短歌を削除しますか？"
          confirmLabel={revisionCount > 1 ? `${revisionCount}稿すべてを削除する` : "削除する"}
          busy={actions.busy === "delete"}
          onConfirm={actions.remove}
          onCancel={() => setConfirmDelete(false)}
        >
          <p className="quote">{tanka?.latestBody ?? rev.bodyNormalized}</p>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
            {revisionCount > 1 ? `第1稿から第${revisionCount}稿までのすべての稿と、` : "この稿と、"}
            チェック結果、「意図的」「誤検出」にした指摘も削除されます。<strong>削除すると元に戻せません。</strong>
          </p>
        </ConfirmDialog>
      )}
    </PcShell>
  );
}

function lookupFinding(revisionIds: string[], runsByRev: Record<string, CheckRun[]>, fp: string): Finding | undefined {
  for (const id of [...revisionIds].reverse()) {
    const f = findingsOf(runsByRev[id]).find((x) => x.fingerprint === fp);
    if (f) return f;
  }
  return undefined;
}

function TimelineLine({ timeline }: { timeline: { no: number; finding: Finding }[] }) {
  return (
    <span>
      {timeline.map((t, i) => (
        <span key={t.no}>
          {i > 0 && " → "}第{t.no}稿 {t.finding.transition === "new" ? "新規" : "継続"}
          {t.finding.matchedText && `「${t.finding.matchedText}」`}
        </span>
      ))}
    </span>
  );
}

function PcFindingCard({
  finding,
  expanded,
  onSelect,
  detailHref,
  timeline,
  onJudge,
  busy,
}: {
  finding: Finding;
  expanded: boolean;
  onSelect: () => void;
  detailHref: string;
  timeline: { no: number; finding: Finding }[];
  onJudge: (s: "intentional" | "false_positive") => void;
  busy: boolean;
}) {
  return (
    <article className={`pc-finding${expanded ? " selected" : ""}`}>
      <div className="head">
        <SeverityBadge severity={finding.severity} />
        <button type="button" className="name" aria-expanded={expanded} onClick={onSelect}>{findingTitle(finding)}</button>
        <span className="small muted">{finding.code}</span>
        <TransitionBadge transition={finding.transition} />
      </div>
      <p className="msg">{finding.message}</p>
      {expanded && (
        <>
          {timeline.length > 0 && (
            <div className="detail">
              <strong>経過</strong>
              <TimelineLine timeline={timeline} />
            </div>
          )}
          <div className="row-buttons">
            <button type="button" className="btn" disabled={busy} onClick={() => onJudge("intentional")}>意図的</button>
            <button type="button" className="btn" disabled={busy} onClick={() => onJudge("false_positive")}>誤検出</button>
          </div>
          <Link to={detailHref} className="small" style={{ fontWeight: 500 }}>このパターンについて詳しく</Link>
        </>
      )}
    </article>
  );
}

function FindingDetail({ base, finding, timeline, actions }: { base: string; finding?: Finding; timeline: { no: number; finding: Finding }[]; actions: ReturnType<typeof useRevisionActions> }) {
  if (!finding) {
    return (
      <>
        <Link to={base} className="pc-back"><BackIcon />指摘の一覧に戻る</Link>
        <p className="muted">指摘が見つかりません。</p>
      </>
    );
  }
  const info = patternInfo(finding.code);
  return (
    <>
      <Link to={base} className="pc-back"><BackIcon />指摘の一覧に戻る</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <SeverityBadge severity={finding.severity} />
        <span className="small muted">
          {finding.code} · {CATEGORIES[finding.code[0]] ?? ""} · {finding.segmentNo ? segLabel(finding.segmentNo) : "一首全体"}
        </span>
        <span style={{ marginLeft: "auto" }}><TransitionBadge transition={finding.transition} /></span>
      </div>
      <h2 style={{ fontSize: 22 }}>{findingTitle(finding)}</h2>
      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h3 style={{ margin: 0 }}>判定の理由</h3>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>{finding.message}</p>
        {finding.confidence < 1 && <p className="small muted" style={{ margin: 0 }}>確からしさ {Math.round(finding.confidence * 100)}%</p>}
      </section>
      {info && (
        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 style={{ margin: 0 }}>このパターンについて</h3>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: "var(--text-2)" }}>{info.definition}</p>
          <Link to={`/patterns#${finding.code}`} style={{ fontSize: 14, fontWeight: 500 }}>このパターンの説明と例を見る</Link>
        </section>
      )}
      {timeline.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 style={{ margin: 0 }}>この指摘の経過</h3>
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
      {actions.error && <p className="error" style={{ margin: 0 }}>{actions.error}</p>}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row-buttons">
          <button type="button" className="btn" disabled={actions.busy === finding.fingerprint} onClick={() => actions.judge(finding.fingerprint, "intentional")}>意図的</button>
          <button type="button" className="btn" disabled={actions.busy === finding.fingerprint} onClick={() => actions.judge(finding.fingerprint, "false_positive")}>誤検出</button>
        </div>
        <span className="small muted" style={{ lineHeight: 1.6 }}>どちらにしても、この指摘を折りたたんで表示します。あとで取り消せます。</span>
      </div>
    </>
  );
}

function HiddenList({ base, feedback, lookup, actions }: { base: string; feedback: { fingerprint: string; status: string; revisionNo: number | null; createdAt: Date }[]; lookup: (fp: string) => Finding | undefined; actions: ReturnType<typeof useRevisionActions> }) {
  const groups = [
    { status: "intentional", label: "意図的" },
    { status: "false_positive", label: "誤検出" },
  ];
  return (
    <>
      <Link to={base} className="pc-back"><BackIcon />指摘の一覧に戻る</Link>
      <h2>非表示にした指摘</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
        「意図的」「誤検出」にした指摘は、この短歌のチェック結果で折りたたんで表示します。取り消すと、また表示します。
      </p>
      {feedback.length === 0 && <p className="muted">非表示にした指摘はありません。</p>}
      {groups.map(({ status, label }) => {
        const items = feedback.filter((f) => f.status === status);
        if (items.length === 0) return null;
        return (
          <section key={status} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h3>{label} {items.length}件</h3>
            {items.map((fb) => {
              const f = lookup(fb.fingerprint);
              return (
                <article key={fb.fingerprint} className="pc-finding">
                  <div className="head">
                    {f && <SeverityBadge severity={f.severity} />}
                    <span className="name" style={{ cursor: "default" }}>{f ? findingTitle(f) : fb.fingerprint}</span>
                    <span className="small muted">{f?.code ?? fb.fingerprint.split(":")[0]}</span>
                  </div>
                  {f && <p className="msg" style={{ fontSize: 13 }}>{f.message}</p>}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span className="small muted">{fb.revisionNo ? `第${fb.revisionNo}稿で設定 · ` : ""}{formatDate(fb.createdAt)}</span>
                    <button type="button" className="pill" disabled={actions.busy === fb.fingerprint} onClick={() => actions.undo(fb.fingerprint)}>取り消す</button>
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </>
  );
}

function AsyncState({ run, stalled, onRecheck, busy }: { run?: CheckRun; stalled: boolean; onRecheck: () => void; busy: boolean }) {
  if (!run) return null;
  if (stalled) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
        意味のチェックが終わっていません
        <button type="button" className="pill" style={{ height: 28, fontSize: 12 }} disabled={busy} onClick={onRecheck}>再チェック</button>
      </span>
    );
  }
  const label: Partial<Record<CheckRun["status"], string>> = {
    done: "すべてのチェック完了",
    skipped: "意味のチェックは省きました",
    limited: "今日の上限に達しました",
    failed: "意味のチェックに失敗しました",
  };
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
      {run.status === "done" && <CheckIcon size={16} />}
      {label[run.status]}
      {(run.status === "failed" || run.status === "skipped") && (
        <button type="button" className="pill" style={{ height: 28, fontSize: 12 }} disabled={busy} onClick={onRecheck}>再チェック</button>
      )}
    </span>
  );
}
