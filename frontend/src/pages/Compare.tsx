import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useRevisions, useRunsByRevision, useTanka } from "../lib/data";
import { findingTitle, latestDoneRun } from "../lib/findings";
import type { CheckRun, Finding } from "../lib/types";
import { Loading, snippet, TopBar } from "../components/ui";

const KANSUJI = ["", "一", "二", "三", "四", "五"];

function findingsOf(runs: CheckRun[] | undefined): Finding[] {
  if (!runs) return [];
  return [...(latestDoneRun(runs, "sync")?.findings ?? []), ...(latestDoneRun(runs, "async")?.findings ?? [])];
}

export default function ComparePage() {
  const { tankaId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: revisions, loading } = useRevisions(tankaId);
  const { data: tanka } = useTanka(tankaId);
  const runsByRev = useRunsByRevision(tankaId, revisions.map((r) => r.id));
  const [a, setA] = useState<string | null>(params.get("a"));
  const [b, setB] = useState<string | null>(params.get("b"));

  useEffect(() => {
    if (revisions.length >= 2) {
      if (!a) setA(revisions[revisions.length - 2].id);
      if (!b) setB(revisions[revisions.length - 1].id);
    }
  }, [revisions, a, b]);

  if (loading) return <Loading />;
  const left = revisions.find((r) => r.id === a);
  const right = revisions.find((r) => r.id === b);

  function pick(side: "a" | "b", id: string) {
    if (side === "a") setA(id);
    else setB(id);
    const next = new URLSearchParams(params);
    next.set(side, id);
    setParams(next, { replace: true });
  }

  const before = findingsOf(left ? runsByRev[left.id] : undefined);
  const after = findingsOf(right ? runsByRev[right.id] : undefined);
  const beforeFp = new Set(before.map((f) => f.fingerprint));
  const afterFp = new Set(after.map((f) => f.fingerprint));
  const resolved = before.filter((f) => !afterFp.has(f.fingerprint));
  const continued = after.filter((f) => beforeFp.has(f.fingerprint));
  const added = after.filter((f) => !beforeFp.has(f.fingerprint));
  const label = (fs: Finding[]) => (fs.length ? fs.map((f) => `${findingTitle(f)} ${f.code}`).join(" · ") : "なし");

  return (
    <>
      <TopBar back={`/t/${tankaId}/history`} backLabel="推敲履歴に戻る" title="稿の比較" sub={snippet(tanka?.latestBody)} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 20px 16px" }}>
        <RevisionSelect label="比べる元の稿" value={a} onChange={(id) => pick("a", id)} options={revisions.map((r) => ({ id: r.id, no: r.revisionNo }))} />
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5F5B53" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        <RevisionSelect label="比べる先の稿" value={b} onChange={(id) => pick("b", id)} options={revisions.map((r) => ({ id: r.id, no: r.revisionNo }))} accent />
      </div>

      {left && right && (
        <>
          <ol className="card" style={{ listStyle: "none", margin: "0 16px", padding: 0 }}>
            {right.segments.map((s, i) => {
              const old = left.segments.find((x) => x.no === s.no);
              const same = old?.text === s.text;
              return (
                <li key={s.no} style={{ display: "flex", gap: 12, padding: "14px 16px", borderBottom: i < 4 ? "1px solid var(--line-2)" : undefined }}>
                  <span className="serif muted" style={{ fontSize: 13, width: 14, paddingTop: 2 }}>{KANSUJI[s.no]}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: same ? 2 : 4 }}>
                    {same ? (
                      <>
                        <span className="serif" style={{ fontSize: 16 }}>{s.text}</span>
                        <span className="small muted">変更なし</span>
                      </>
                    ) : (
                      <>
                        <del className="serif" style={{ fontSize: 14, color: "#6F6A62" }}>{old?.text}</del>
                        <ins className="serif" style={{ fontSize: 16, textDecoration: "none", borderBottom: "2px solid var(--accent)", alignSelf: "flex-start" }}>{s.text}</ins>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {right.note && <p className="muted" style={{ margin: "12px 20px 0", fontSize: 13 }}>第{right.revisionNo}稿のメモ：{right.note}</p>}

          <h2 className="section-title">指摘の変化</h2>
          <div className="card" style={{ margin: "0 16px 32px", padding: "4px 16px" }}>
            {[
              { l: "解消", c: "var(--accent)", fs: resolved },
              { l: "継続", c: "var(--muted)", fs: continued },
              { l: "新規", c: "var(--high)", fs: added },
            ].map((row, i) => (
              <div key={row.l} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: i < 2 ? "1px solid var(--line-2)" : undefined }}>
                <span style={{ width: 40, fontSize: 12, fontWeight: 500, color: row.c, flex: "none" }}>{row.l}</span>
                <span style={{ fontSize: 14 }}>{label(row.fs)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function RevisionSelect({ label, value, onChange, options, accent }: { label: string; value: string | null; onChange: (id: string) => void; options: { id: string; no: number }[]; accent?: boolean }) {
  return (
    <label style={{ flex: 1 }}>
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", height: 44, borderRadius: 10, fontSize: 14, padding: "0 10px", fontFamily: "var(--sans)",
          border: accent ? "1.5px solid var(--accent)" : "1px solid var(--control)",
          background: accent ? "var(--accent-bg)" : "var(--surface)", color: accent ? "var(--accent)" : "var(--text)",
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>第{o.no}稿</option>
        ))}
      </select>
    </label>
  );
}
