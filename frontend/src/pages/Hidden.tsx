import { useState } from "react";
import { useParams } from "react-router-dom";
import { deleteFeedback } from "../lib/api";
import { useFeedback, useRevisions, useRunsByRevision, useTanka } from "../lib/data";
import { findingTitle, latestDoneRun } from "../lib/findings";
import type { Feedback, Finding } from "../lib/types";
import { formatDate, Loading, SeverityBadge, TopBar } from "../components/ui";

export default function HiddenPage() {
  const { tankaId = "" } = useParams();
  const { data: tanka } = useTanka(tankaId);
  const { data: feedback, loading } = useFeedback(tankaId);
  const { data: revisions } = useRevisions(tankaId);
  const runsByRev = useRunsByRevision(tankaId, revisions.map((r) => r.id));
  const [busy, setBusy] = useState<string | null>(null);

  if (loading) return <Loading />;

  // 指摘の中身は、その fingerprint が出ている一番新しい稿から引く
  function lookup(fp: string): Finding | undefined {
    for (const r of [...revisions].reverse()) {
      const runs = runsByRev[r.id] ?? [];
      const f = [...(latestDoneRun(runs, "sync")?.findings ?? []), ...(latestDoneRun(runs, "async")?.findings ?? [])].find((x) => x.fingerprint === fp);
      if (f) return f;
    }
    return undefined;
  }

  async function undo(fp: string) {
    setBusy(fp);
    try {
      await deleteFeedback(tankaId, fp);
    } finally {
      setBusy(null);
    }
  }

  const groups: { status: Feedback["status"]; label: string }[] = [
    { status: "intentional", label: "意図的" },
    { status: "false_positive", label: "誤検出" },
  ];

  return (
    <>
      <TopBar
        back={tanka?.currentRevisionId ? `/t/${tankaId}/r/${tanka.currentRevisionId}` : "/"}
        backLabel="チェック結果に戻る"
        title="非表示にした指摘"
        sub={tanka?.title || "無題"}
      />
      <p className="muted" style={{ margin: 0, padding: "4px 20px 8px", fontSize: 13, lineHeight: 1.7 }}>
        「意図的」「誤検出」にした指摘は、この短歌のチェック結果で折りたたんで表示します。取り消すと、また表示します。
      </p>
      {feedback.length === 0 && <div className="center-msg">非表示にした指摘はありません。</div>}
      {groups.map(({ status, label }) => {
        const items = feedback.filter((f) => f.status === status);
        if (items.length === 0) return null;
        return (
          <section key={status}>
            <h2 className="section-title">{label} {items.length}件</h2>
            <div className="stack">
              {items.map((fb) => {
                const f = lookup(fb.fingerprint);
                return (
                  <article key={fb.fingerprint} className="card finding">
                    <div className="head">
                      {f && <SeverityBadge severity={f.severity} />}
                      <span className="name">{f ? findingTitle(f) : fb.fingerprint}</span>
                      <span className="code">{f?.code ?? fb.fingerprint.split(":")[0]}</span>
                    </div>
                    {f && <p className="msg">{f.message}</p>}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span className="small muted">{formatDate(fb.createdAt)} に設定</span>
                      <button type="button" className="pill" disabled={busy === fb.fingerprint} onClick={() => undo(fb.fingerprint)}>取り消す</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
