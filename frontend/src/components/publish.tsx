// 発表を記録する／記録を直すフォーム（スマホは1画面、PCは中央のダイアログ）
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { checkPublications, createPublication, deletePublication, updatePublication } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDestinations, usePublication, usePublications, useRevision, useRevisions, useSequences, useTankaPublications, useTankas } from "../lib/data";
import { duplicateLine, formatDay, publicationSummary, sequenceDuplicateLine, sequenceTitle, todayISO } from "../lib/publishing";
import type { Publication } from "../lib/types";
import { TankaPickerSheet, WarnIcon } from "./library";
import { ConfirmDialog, Loading } from "./ui";

type Mode = "tanka" | "sequence";

export function PublishForm({ pc }: { pc?: boolean }) {
  const { publicationId } = useParams();
  const editing = Boolean(publicationId);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: tankas } = useTankas(user?.uid);
  const { data: sequences } = useSequences(user?.uid);
  const { data: destinations } = useDestinations(user?.uid);
  const { data: allPubs } = usePublications(user?.uid);
  const { data: existing, loading: loadingExisting } = usePublication(publicationId);

  const [mode, setMode] = useState<Mode>(params.get("s") ? "sequence" : "tanka");
  const [tankaId, setTankaId] = useState<string | null>(params.get("t"));
  const [revisionId, setRevisionId] = useState<string | null>(params.get("r"));
  const [sequenceId, setSequenceId] = useState<string | null>(params.get("s"));
  const [picking, setPicking] = useState<null | "tanka" | "revision">(null);
  const [destination, setDestination] = useState("");
  const [submittedOn, setSubmittedOn] = useState(todayISO());
  const [note, setNote] = useState("");
  const [dupes, setDupes] = useState<Publication[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 直すときは、記録の値から始める
  useEffect(() => {
    if (!existing) return;
    setDestination(existing.destination);
    setSubmittedOn(existing.submittedOn);
    setNote(existing.note ?? "");
  }, [existing]);

  const tanka = tankas.find((t) => t.id === tankaId);
  const revId = revisionId ?? tanka?.currentRevisionId ?? null;
  const { data: rev } = useRevision(tankaId ?? undefined, revId);
  const seq = sequences.find((s) => s.id === sequenceId);
  const targetIds = mode === "tanka" ? (tankaId ? [tankaId] : []) : (seq?.items.map((i) => i.tankaId) ?? []);
  const targetKey = targetIds.join(",");

  // 二重投稿の確認（記録する前に、同じ短歌を含む発表記録を探す）
  useEffect(() => {
    if (editing || targetIds.length === 0) {
      setDupes([]);
      return;
    }
    let alive = true;
    checkPublications(targetIds)
      .then((found) => alive && setDupes(found))
      .catch(() => alive && setDupes([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, editing]);

  const close = () => (window.history.length > 1 ? navigate(-1) : navigate("/publications"));
  const ready = editing
    ? Boolean(existing)
    : mode === "tanka"
      ? Boolean(tankaId && revId)
      : Boolean(seq && seq.items.length > 0);
  const canSubmit = ready && destination.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(submittedOn) && !busy;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;
    setBusy("save");
    setError(null);
    const fields = { destination: destination.trim(), submittedOn, note: note.trim() || null };
    try {
      if (editing && existing) await updatePublication(existing.id, fields);
      else if (mode === "tanka") await createPublication({ ...fields, items: [{ tankaId: tankaId!, revisionId: revId! }] });
      else await createPublication({ ...fields, sequenceId: seq!.id });
      navigate("/publications", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "記録できませんでした");
      setBusy(null);
    }
  }

  async function remove() {
    if (!existing) return;
    setBusy("delete");
    try {
      await deletePublication(existing.id);
      navigate("/publications", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除できませんでした");
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  if (editing && loadingExisting) return <Loading />;
  if (editing && !existing) return <div className="center-msg">この記録は見つかりません。</div>;

  const what = editing && existing ? (
    <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <legend className="label-text" style={{ padding: 0, marginBottom: 8, fontSize: 14, fontWeight: 500 }}>出したもの</legend>
      <div className="picked">
        <p className="poem">{existing.items[0]?.body}{existing.items.length > 1 && <span className="small muted">　ほか{existing.items.length - 1}首</span>}</p>
        <span className="small muted">{publicationSummary(existing)}</span>
      </div>
      <p className="hint">出したものは直せません。間違えたときは、この記録を削除して記録し直してください。</p>
    </fieldset>
  ) : (
    <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <legend style={{ padding: 0, marginBottom: 8, fontSize: 14, fontWeight: 500 }}>出したもの</legend>
      <div className="switch" role="group" aria-label="出したもの">
        <button type="button" aria-pressed={mode === "tanka"} onClick={() => setMode("tanka")}>この歌（1首）</button>
        <button type="button" aria-pressed={mode === "sequence"} onClick={() => setMode("sequence")}>連作から選ぶ</button>
      </div>
      {mode === "tanka" ? (
        tanka && rev ? (
          <div className="picked">
            <p className="poem">{rev.bodyNormalized}</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span className="small muted">第{rev.revisionNo}稿{rev.id === tanka.currentRevisionId && " · いまの稿"}</span>
              <span style={{ display: "flex" }}>
                <button type="button" className="text-btn accent" onClick={() => setPicking("revision")}>別の稿にする</button>
                {!params.get("t") && <button type="button" className="text-btn accent" onClick={() => setPicking("tanka")}>別の歌</button>}
              </span>
            </div>
          </div>
        ) : (
          <button type="button" className="add-dashed" style={{ margin: 0 }} onClick={() => setPicking("tanka")}>歌を選ぶ</button>
        )
      ) : sequences.length === 0 ? (
        <p className="hint">まだ連作がありません。連作の画面で作れます。</p>
      ) : (
        <ul className="choice-list" aria-label="連作">
          {sequences.map((s) => {
            // 選ぶ時点で、出したことがあるかを見せる（連作として出したか、中に出した歌があるか）
            const published = allPubs.some((p) => p.sequenceId === s.id);
            const publishedSongs = s.items.filter((i) => (tankas.find((t) => t.id === i.tankaId)?.publishedCount ?? 0) > 0).length;
            return (
              <li key={s.id}>
                <button type="button" aria-pressed={s.id === sequenceId} disabled={s.items.length === 0} onClick={() => setSequenceId(s.id)}>
                  <span style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 600 }}>{sequenceTitle(s)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span className="small muted">{s.items.length}首{s.items.length === 0 && " · 歌が入っていません"}</span>
                    {published ? (
                      <span className="chip outline-accent">発表済み</span>
                    ) : publishedSongs > 0 ? (
                      <span className="chip outline-accent">出した歌 {publishedSongs}首</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );

  const warning = dupes.length > 0 && (
    <div role="alert" className="warn-box">
      <span style={{ flexShrink: 0, paddingTop: 2 }}><WarnIcon /></span>
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="title">{mode === "tanka" ? "この歌はすでに出しています" : "すでに出した歌が含まれています"}</span>
        <span className="text">
          {dupes.slice(0, 3).map((p) => (mode === "sequence" && seq ? sequenceDuplicateLine(p, seq) : duplicateLine(p, tankaId))).join("")}
          {dupes.length > 3 && `ほか${dupes.length - 3}件。`}
          未発表の作品だけを受け付ける出し先では、二重投稿になることがあります。記録はこのままできます。
        </span>
      </span>
    </div>
  );

  const fields = (
    <>
      <div className="form-field">
        <label htmlFor="pub-dest">出し先</label>
        <input id="pub-dest" className="form-input" type="text" maxLength={100} value={destination} placeholder="例：○○新聞 歌壇" onChange={(e) => setDestination(e.target.value)} />
        {destinations.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label="前に使った出し先">
            {destinations.slice(0, 8).map((d) => (
              <button key={d} type="button" className="pill" aria-pressed={d === destination.trim()} onClick={() => setDestination(d)}>{d}</button>
            ))}
          </div>
        )}
      </div>
      <div className="form-field">
        <label htmlFor="pub-date">出した日</label>
        <input id="pub-date" className="form-input" type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="pub-memo">メモ<span style={{ fontWeight: 400, color: "var(--muted)" }}>（任意）</span></label>
        <textarea id="pub-memo" className="form-textarea" rows={3} maxLength={500} placeholder="結果や掲載号など。例：12月号に掲載" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </>
  );

  const submitLabel = editing ? "記録を直す" : "記録する";
  const sheets = (
    <>
      {picking === "tanka" && (
        <TankaPickerSheet
          purpose="publish"
          exclude={[]}
          onPick={(id) => {
            setTankaId(id);
            setRevisionId(null);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === "revision" && tankaId && (
        <RevisionPicker tankaId={tankaId} current={revId} onPick={(id) => { setRevisionId(id); setPicking(null); }} onClose={() => setPicking(null)} />
      )}
      {confirmDelete && (
        <ConfirmDialog title="この記録を削除しますか？" confirmLabel="記録を削除する" busy={busy === "delete"} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>短歌と連作は消えません。</p>
        </ConfirmDialog>
      )}
    </>
  );

  if (pc) {
    return (
      <form className="pc-modal" role="dialog" aria-modal="true" aria-labelledby="pub-title" onSubmit={submit}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 id="pub-title" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{editing ? "発表記録を直す" : "発表を記録"}</h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={close}><CloseIcon /></button>
        </div>
        <div className="form-stack">
          {what}
          {warning}
          {fields}
        </div>
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          {editing && <button type="button" className="pc-btn danger" style={{ marginRight: "auto" }} onClick={() => setConfirmDelete(true)}>記録を削除</button>}
          <button type="button" className="pc-btn" style={{ height: 44 }} onClick={close}>キャンセル</button>
          <button type="submit" className="pc-btn primary" style={{ height: 44, padding: "0 22px" }} disabled={!canSubmit}>{submitLabel}</button>
        </div>
        {sheets}
      </form>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="閉じる" onClick={close}><CloseIcon /></button>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{editing ? "発表記録を直す" : "発表を記録"}</span>
          <span className="small muted">出したことを残しておきます</span>
        </div>
      </header>
      <div className="form-stack">
        {what}
        {warning}
        {fields}
        {editing && <button type="button" className="text-btn danger" style={{ alignSelf: "flex-start", padding: 0 }} onClick={() => setConfirmDelete(true)}>この記録を削除</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="footer-bar">
        <button type="submit" className="btn-primary" disabled={!canSubmit}>{submitLabel}</button>
      </div>
      {sheets}
    </form>
  );
}

function RevisionPicker({ tankaId, current, onPick, onClose }: { tankaId: string; current: string | null; onPick: (id: string) => void; onClose: () => void }) {
  const { user } = useAuth();
  const { data: revisions } = useRevisions(tankaId);
  const { data: pubs } = useTankaPublications(user?.uid, tankaId);
  // 稿ごとに、出した記録（いつ・どこに）
  const sent = (revisionId: string) => pubs.filter((p) => p.items.some((i) => i.tankaId === tankaId && i.revisionId === revisionId));
  return (
    <div className="dialog-layer">
      <button type="button" className="dialog-backdrop" aria-label="閉じる" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="rev-title" className="dialog">
        <div aria-hidden="true" className="dialog-handle" />
        <h2 id="rev-title" style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>出した稿を選ぶ</h2>
        <ul className="choice-list">
          {[...revisions].reverse().map((r) => (
            <li key={r.id}>
              <button type="button" aria-pressed={r.id === current} onClick={() => onPick(r.id)}>
                <span className="poem">{r.bodyNormalized}</span>
                <span className="small muted">第{r.revisionNo}稿</span>
                {sent(r.id).map((p) => (
                  <span key={p.id} className="small" style={{ color: "var(--accent)", fontWeight: 500 }}>
                    {formatDay(p.submittedOn, "short")} {p.destination}に出した稿
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
      </section>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
