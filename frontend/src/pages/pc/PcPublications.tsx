// PC版の発表記録。左に記録の一覧（検索付き）、右に選んだ記録の詳細か「発表を記録」のフォーム
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { PcHeader, SideSearch } from "../../components/pc";
import { PublishForm } from "../../components/publish";
import { DangerFooter, DeletePublicationDialog, DetailSection, PublicationHistory, PublicationRelations, PublishedItem } from "../../components/detail";
import { formatDate, Loading, PlusIcon } from "../../components/ui";
import { deletePublication, updatePublication } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { usePublications, useTankas } from "../../lib/data";
import { formatDay, kanjiNumber, publicationSummary } from "../../lib/publishing";
import type { Publication } from "../../lib/types";
import { useGoneTankas } from "../Publications";

/** 発表記録の画面の枠。左の列に記録の一覧を出す。 */
function PcPublicationsLayout({ activeId, publishing, children }: { activeId?: string; publishing?: boolean; children: ReactNode }) {
  const { user } = useAuth();
  const { data: pubs } = usePublications(user?.uid);
  const isGone = useGoneTankas();
  const [q, setQ] = useState("");
  const needle = q.trim();
  const shown = needle ? pubs.filter((p) => p.destination.includes(needle) || p.items.some((i) => i.body.includes(needle))) : pubs;
  return (
    <div className="pc">
      <PcHeader />
      <div className="pc-body">
        <aside className="pc-sidebar" style={{ flexBasis: 300 }}>
          <Link to="/publish" className="btn-primary pc-new" aria-current={publishing ? "page" : undefined}>
            <PlusIcon />
            発表を記録
          </Link>
          {pubs.length > 0 && <SideSearch label="発表記録を検索" placeholder="出し先や本文で探す" value={q} onChange={setQ} />}
          {pubs.length > 0 && <span className="small muted" style={{ padding: "0 4px" }}>{pubs.length}件 · 出した日の新しい順</span>}
          {needle && shown.length === 0 && <p className="small muted" style={{ margin: 0, padding: "0 12px" }}>「{q}」に当たる記録はありません。</p>}
          <nav aria-label="発表記録の一覧" className="pc-pub-list">
            {shown.map((p) => {
              const gone = p.items.length === 1 && isGone(p.items[0].tankaId);
              return (
                <Link key={p.id} to={`/publications/${p.id}`} aria-current={p.id === activeId ? "page" : undefined}>
                  <span className="dest">{p.destination}</span>
                  <span className="poem">{p.items[0]?.body}</span>
                  <span className="small muted">{publicationSummary(p)} · {formatDay(p.submittedOn, "short")}</span>
                  {gone && (
                    <span className="chips">
                      <span className="chip outline">削除した歌</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="pc-main" style={{ maxWidth: 920 }}>{children}</main>
      </div>
    </div>
  );
}

/** /publications：記録があれば最新の記録を開く。 */
export default function PcPublications() {
  const { user } = useAuth();
  const { data: pubs, loading } = usePublications(user?.uid);
  if (!loading && pubs.length > 0) return <Navigate to={`/publications/${pubs[0].id}`} replace />;
  return (
    <PcPublicationsLayout>
      {loading ? (
        <Loading />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>まだ発表の記録がありません</h1>
          <p className="muted" style={{ margin: 0, lineHeight: 1.8 }}>
            歌壇や賞、SNS などに出したら、どの稿をどこにいつ出したかを残しておけます。同じ歌を出そうとすると知らせます。左の「発表を記録」から記録できます。
          </p>
        </div>
      )}
    </PcPublicationsLayout>
  );
}

/** /publish：一覧の右に「発表を記録」のフォームを出す。 */
export function PcPublish() {
  return (
    <PcPublicationsLayout publishing>
      <PublishForm pc />
    </PcPublicationsLayout>
  );
}

/** /publications/:id：一覧の右に記録の詳細を出す。出し先・出した日・メモはその場で直せる。 */
export function PcPublication() {
  const { publicationId = "" } = useParams();
  const { user } = useAuth();
  const { data: pubs, loading } = usePublications(user?.uid);
  const pub = pubs.find((p) => p.id === publicationId);
  return (
    <PcPublicationsLayout activeId={publicationId}>
      {loading ? <Loading /> : pub ? <PublicationEditor key={pub.id} pub={pub} /> : <p className="muted">この記録は見つかりません。</p>}
    </PcPublicationsLayout>
  );
}

function PublicationEditor({ pub }: { pub: Publication }) {
  const { user } = useAuth();
  const { data: tankas } = useTankas(user?.uid);
  const tankasById = useMemo(() => new Map(tankas.map((t) => [t.id, t])), [tankas]);
  const navigate = useNavigate();
  const [destination, setDestination] = useState(pub.destination);
  const [submittedOn, setSubmittedOn] = useState(pub.submittedOn);
  const [note, setNote] = useState(pub.note ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const saved = useRef({ destination: pub.destination, submittedOn: pub.submittedOn, note: pub.note ?? "" });

  // 別の端末で直されたら反映する（入力中の欄は、保存した値と同じときだけ置き換える）
  useEffect(() => {
    const prev = saved.current;
    if (destination === prev.destination) setDestination(pub.destination);
    if (submittedOn === prev.submittedOn) setSubmittedOn(pub.submittedOn);
    if (note === prev.note) setNote(pub.note ?? "");
    saved.current = { destination: pub.destination, submittedOn: pub.submittedOn, note: pub.note ?? "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub.destination, pub.submittedOn, pub.note]);

  /** 欄を離れたら保存する（変わっていて、正しい値のときだけ） */
  async function save() {
    const next = { destination: destination.trim(), submittedOn, note: note.trim() };
    const prev = saved.current;
    if (next.destination === prev.destination && next.submittedOn === prev.submittedOn && next.note === prev.note) return;
    if (!next.destination || !/^\d{4}-\d{2}-\d{2}$/.test(next.submittedOn)) {
      setState("error");
      setMessage("出し先と出した日を入れてください");
      return;
    }
    setState("saving");
    setMessage(null);
    try {
      await updatePublication(pub.id, { ...next, note: next.note || null });
      saved.current = next;
      setState("saved");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deletePublication(pub.id);
      navigate("/publications", { replace: true });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "削除できませんでした");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const status =
    state === "saving" ? "保存中…" : state === "saved" ? `保存しました · ${formatDate(pub.updatedAt)}` : state === "error" ? message : "直すと自動で保存します";

  return (
    <>
      <div className="pc-titlebar">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1>{pub.destination}</h1>
          <span className="meta">{publicationSummary(pub)} · {formatDay(pub.submittedOn, "short")}</span>
        </div>
      </div>
      <section className="card pub-edit">
        <div className="form-grid2">
          <div className="form-field">
            <label htmlFor="pd-dest">出し先</label>
            <input id="pd-dest" className="form-input" type="text" maxLength={100} value={destination} onChange={(e) => setDestination(e.target.value)} onBlur={save} />
          </div>
          <div className="form-field">
            <label htmlFor="pd-date">出した日</label>
            <input id="pd-date" className="form-input" type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} onBlur={save} />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="pd-memo">メモ</label>
          <textarea id="pd-memo" className="form-textarea" rows={2} maxLength={500} placeholder="結果や掲載号など。例：12月号に掲載" value={note} onChange={(e) => setNote(e.target.value)} onBlur={save} />
        </div>
        <span role="status" aria-live="polite" className="save-status" data-state={state === "error" ? "error" : state === "idle" ? "saved" : state}>
          {state === "saving" && <span className="spinner" aria-hidden="true" style={{ width: 12, height: 12 }} />}
          {status}
        </span>
      </section>
      <DetailSection title="出したもの">
        <p className="hint">出した時点の稿と本文です。後で推敲しても変わりません。出したものを間違えたときは、記録を削除して記録し直してください。</p>
        <ol className="pub-items">
          {pub.items.map((it, i) => (
            <PublishedItem key={`${it.tankaId}-${i}`} no={kanjiNumber(i + 1)} item={it} tanka={tankasById.get(it.tankaId)} many={pub.items.length > 1} />
          ))}
        </ol>
      </DetailSection>
      <PublicationRelations pub={pub} />
      <PublicationHistory pub={pub} />
      <DangerFooter label="この記録を削除" onClick={() => setConfirmDelete(true)} />
      {confirmDelete && (
        <DeletePublicationDialog pub={pub} busy={deleting} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
      )}
    </>
  );
}
