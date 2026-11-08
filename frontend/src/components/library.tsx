// 連作と発表記録の共通部品（スマホ・PC）
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createSequence, updateSequence } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRevision, useSequences, useTankaPublications, useTankas } from "../lib/data";
import { formatDay, kanjiNumber, publishedRevisionNo, sequenceTitle } from "../lib/publishing";
import type { Revision, Sequence, Tanka } from "../lib/types";

type Item = Sequence["items"][number];

export function GripIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#8A857C" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

export function WarnIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A8391A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v4M12 17v.5" />
    </svg>
  );
}

/** 短歌・連作・発表記録の切り替え。 */
export function LibraryTabs({ active, pc }: { active: "tankas" | "sequences" | "publications"; pc?: boolean }) {
  const tabs = [
    { key: "tankas", to: "/", label: "短歌" },
    { key: "sequences", to: "/sequences", label: "連作" },
    { key: "publications", to: "/publications", label: "発表記録" },
  ] as const;
  return (
    <nav aria-label="表示の切り替え" className={pc ? "lib-tabs lib-tabs-pc" : "lib-tabs"}>
      {tabs.map((t) => (
        <Link key={t.key} to={t.to} aria-current={t.key === active ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

/** 一覧のカードに出す「発表済み」「連作 N」。記録から自動で表示し、別のフラグは持たない。 */
export function PublishedChips({ tanka }: { tanka: Tanka }) {
  const seqs = tanka.sequenceIds?.length ?? 0;
  return (
    <>
      {(tanka.publishedCount ?? 0) > 0 && <span className="chip outline-accent">発表済み</span>}
      {seqs > 0 && <span className="chip outline">連作 {seqs}</span>}
    </>
  );
}

/** 削除の確認で伝える、連作と発表記録の扱い。 */
export function DeleteNote({ tanka }: { tanka: Tanka | null | undefined }) {
  const { user } = useAuth();
  const { data: sequences } = useSequences(user?.uid);
  if (!tanka) return null;
  const titles = sequences.filter((s) => tanka.sequenceIds?.includes(s.id)).map((s) => `「${sequenceTitle(s)}」`);
  const pubs = tanka.publishedCount ?? 0;
  if (titles.length === 0 && pubs === 0) return null;
  return (
    <p className="small muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
      {titles.length > 0 && `連作${titles.join("")}からは外れます。`}
      {pubs > 0 && `発表記録（${pubs}件）は、本文の写しとともに残ります。`}
    </p>
  );
}

/** 下からのシート（スマホ）／中央のダイアログ（PC）。 */
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-layer">
      <button type="button" className="dialog-backdrop" aria-label="閉じる" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="sheet-title" className="dialog">
        <div aria-hidden="true" className="dialog-handle" />
        <h2 id="sheet-title" style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{title}</h2>
        {children}
        <button type="button" className="btn-secondary" onClick={onClose}>閉じる</button>
      </section>
    </div>
  );
}

/** 連作に加える歌を選ぶ。入るのはその時点のいまの稿。 */
export function TankaPickerSheet({ exclude, onPick, onClose }: { exclude: string[]; onPick: (tankaId: string) => void; onClose: () => void }) {
  const { user } = useAuth();
  const { data: tankas } = useTankas(user?.uid);
  const list = tankas.filter((t) => t.currentRevisionId);
  return (
    <Sheet title="歌を加える" onClose={onClose}>
      <p className="hint">いまの稿が入ります。後で推敲しても、連作の中身は変わりません。</p>
      <ul className="choice-list">
        {list.map((t) => (
          <li key={t.id}>
            <button type="button" disabled={exclude.includes(t.id)} onClick={() => onPick(t.id)}>
              <span className="poem">{t.latestBody}</span>
              <span className="small muted">第{t.latestRevisionNo}稿{exclude.includes(t.id) && " · この連作に入っています"}</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="muted small">まだ短歌がありません。</li>}
      </ul>
    </Sheet>
  );
}

/** 結果画面の「連作に入れる」。既存の連作か、新しい連作に、いまの稿を入れる。 */
export function AddToSequenceSheet({ tanka, onClose }: { tanka: Tanka; onClose: () => void }) {
  const { user } = useAuth();
  const { data: sequences } = useSequences(user?.uid);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<Sequence>) {
    setBusy(true);
    setError(null);
    try {
      const seq = await fn();
      navigate(`/sequences/${seq.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "連作に入れられませんでした");
      setBusy(false);
    }
  }
  const addTo = (seq: Sequence) =>
    run(() => updateSequence(seq.id, { title: seq.title, note: seq.note, items: [...seq.items, { tankaId: tanka.id }] }));

  return (
    <Sheet title="連作に入れる" onClose={onClose}>
      <p className="hint">いまの稿（第{tanka.latestRevisionNo}稿）が入ります。1首を複数の連作に入れられます。</p>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <ul className="choice-list">
        {sequences.map((s) => {
          const inside = s.items.some((i) => i.tankaId === tanka.id);
          return (
            <li key={s.id}>
              <button type="button" disabled={busy || inside} onClick={() => addTo(s)}>
                <span style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 600 }}>{sequenceTitle(s)}</span>
                <span className="small muted">{s.items.length}首{inside && " · この歌は入っています"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => run(() => createSequence({ title: "", items: [{ tankaId: tanka.id }] }))}>
        新しい連作に入れる
      </button>
    </Sheet>
  );
}

/** 結果画面の「発表と連作」。その歌の発表記録と、入っている連作。 */
export function PublishAndSequenceSection({ tanka, rev, pc }: { tanka: Tanka; rev: Revision; pc?: boolean }) {
  const { user } = useAuth();
  const { data: pubs } = useTankaPublications(user?.uid, tanka.id);
  const { data: sequences } = useSequences(user?.uid);
  const [adding, setAdding] = useState(false);
  const mine = sequences.filter((s) => s.items.some((i) => i.tankaId === tanka.id));
  const Heading = pc ? "h3" : "h2";
  const rows = (
    <>
      {pubs.map((p) => {
        const no = publishedRevisionNo(p, tanka.id);
        const what = p.sequenceId ? `連作「${p.sequenceTitle || "無題"}」で第${no}稿を出した` : `第${no}稿を出した`;
        return (
          <Link key={p.id} to="/publications" className="linked-row">
            <span className="chip outline-accent" style={{ flexShrink: 0 }}>発表済み</span>
            <span className="what">
              <span className="t">{p.destination}</span>
              <span className="s">{formatDay(p.submittedOn, "short")} · {what}</span>
            </span>
            {!pc && <span aria-hidden="true" style={{ color: "var(--placeholder)" }}>›</span>}
          </Link>
        );
      })}
      {mine.map((s) => (
        <SequenceLink key={s.id} seq={s} tanka={tanka} rev={rev} pc={pc} />
      ))}
    </>
  );
  const empty = pubs.length === 0 && mine.length === 0;
  return (
    <>
      <Heading className={pc ? undefined : "section-title"} style={pc ? { margin: "14px 0 0" } : { marginTop: 28 }}>発表と連作</Heading>
      {empty ? (
        <p className="small muted" style={pc ? { margin: 0 } : { margin: "0 20px" }}>まだ発表の記録はなく、連作にも入っていません。</p>
      ) : pc ? (
        rows
      ) : (
        <div className="linked-rows">{rows}</div>
      )}
      <div className="row-actions">
        <Link to={`/publish?t=${tanka.id}&r=${rev.id}`} className="accent">発表を記録</Link>
        <button type="button" onClick={() => setAdding(true)}>連作に入れる</button>
      </div>
      {adding && <AddToSequenceSheet tanka={tanka} onClose={() => setAdding(false)} />}
    </>
  );
}

function SequenceLink({ seq, tanka, rev, pc }: { seq: Sequence; tanka: Tanka; rev: Revision; pc?: boolean }) {
  const item = seq.items.find((i) => i.tankaId === tanka.id);
  const { data: inside } = useRevision(tanka.id, item?.revisionId);
  const stale = item?.revisionId !== tanka.currentRevisionId;
  const sub = item?.revisionId === rev.id ? "この稿が入っています" : inside ? `連作には第${inside.revisionNo}稿が入っています` : "";
  return (
    <Link to={`/sequences/${seq.id}`} className="linked-row">
      <span className="chip outline" style={{ flexShrink: 0 }}>連作</span>
      <span className="what">
        <span className="t">「{sequenceTitle(seq)}」に入っています</span>
        {sub && <span className={stale ? "s stale" : "s"}>{sub}</span>}
      </span>
      {!pc && <span aria-hidden="true" style={{ color: "var(--placeholder)" }}>›</span>}
    </Link>
  );
}

/**
 * 連作の歌の並び。つまみをドラッグ（または矢印キー）で並べ替える。
 * 入れた稿といまの稿が違えば「新しい稿があります」と出し、差し替えるかは作者が選ぶ。
 */
export function SequenceItems({
  items,
  tankasById,
  onChange,
  disabled,
  pc,
}: {
  items: Item[];
  tankasById: Map<string, Tanka>;
  onChange: (items: Item[]) => void;
  disabled?: boolean;
  pc?: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ index: number; order: Item[]; moved: boolean } | null>(null);
  const shown = drag ? drag.order : items;

  function move(order: Item[], from: number, to: number): Item[] {
    const next = [...order];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    return next;
  }
  function onPointerDown(i: number, e: PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ index: i, order: items, moved: false });
  }
  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag || !listRef.current) return;
    const rows = Array.from(listRef.current.children) as HTMLElement[];
    let found = rows.findIndex((li) => {
      const r = li.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (found === -1) found = rows.length;
    const target = Math.max(0, Math.min(rows.length - 1, found > drag.index ? found - 1 : found));
    if (target !== drag.index) setDrag({ index: target, order: move(drag.order, drag.index, target), moved: true });
  }
  function onPointerUp() {
    if (drag?.moved) onChange(drag.order);
    setDrag(null);
  }
  function onKeyDown(i: number, e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
    if (to < 0 || to >= items.length) return;
    e.preventDefault();
    onChange(move(items, i, to));
    requestAnimationFrame(() => (listRef.current?.children[to]?.querySelector(".drag-handle") as HTMLElement | null)?.focus());
  }

  return (
    <ol ref={listRef} className="seq-items">
      {shown.map((item, i) => (
        <SequenceItemRow
          key={item.tankaId}
          no={i + 1}
          item={item}
          tanka={tankasById.get(item.tankaId)}
          dragging={drag?.order[drag.index]?.tankaId === item.tankaId}
          pc={pc}
          disabled={disabled}
          handle={{
            onPointerDown: (e) => onPointerDown(i, e),
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onKeyDown: (e) => onKeyDown(i, e),
          }}
          onReplace={() => onChange(items.map((x) => (x.tankaId === item.tankaId ? { ...x, revisionId: tankasById.get(x.tankaId)!.currentRevisionId! } : x)))}
          onRemove={() => onChange(items.filter((x) => x.tankaId !== item.tankaId))}
        />
      ))}
    </ol>
  );
}

function SequenceItemRow({
  no,
  item,
  tanka,
  dragging,
  pc,
  disabled,
  handle,
  onReplace,
  onRemove,
}: {
  no: number;
  item: Item;
  tanka: Tanka | undefined;
  dragging: boolean;
  pc?: boolean;
  disabled?: boolean;
  handle: {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  };
  onReplace: () => void;
  onRemove: () => void;
}) {
  const { data: rev } = useRevision(item.tankaId, item.revisionId);
  const label = `${kanjiNumber(no)}首目`;
  const isCurrent = tanka?.currentRevisionId === item.revisionId;
  const stale = tanka?.currentRevisionId && !isCurrent;
  const revLabel = rev ? `第${rev.revisionNo}稿${isCurrent ? " · いまの稿" : ""}` : "";
  return (
    <li className={dragging ? "seq-item dragging" : "seq-item"}>
      <button type="button" className="drag-handle" aria-label={`${label}を並べ替え（上下の矢印キーでも動かせます）`} disabled={disabled} {...handle}>
        <GripIcon />
      </button>
      {pc && <span className="num">{kanjiNumber(no)}</span>}
      <div className="body">
        {!pc && <span className="small muted">{kanjiNumber(no)}{revLabel && ` · ${revLabel}`}</span>}
        <p className="poem">{rev?.bodyNormalized ?? tanka?.latestBody ?? "…"}</p>
        {pc && revLabel && <span className="small muted">{revLabel}</span>}
        {stale && (
          <div className="stale-note">
            <span>新しい稿があります（第{tanka?.latestRevisionNo}稿）</span>
            <button type="button" disabled={disabled} onClick={onReplace}>差し替える</button>
          </div>
        )}
      </div>
      <button type="button" className="text-btn" aria-label={`${label}を連作から外す`} disabled={disabled} onClick={onRemove}>外す</button>
    </li>
  );
}
