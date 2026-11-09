// 詳細ページの区画（設計書「詳細ページの構造」）。短歌・連作・発表記録の詳細を、スマホもPCも同じ順で作る：
// 見出しと情報 → 中身 → つながり → 履歴 → 操作 → 削除（いちばん下）
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useRevision, useRevisions, useSequencePublications, useSequences, useTankaPublications } from "../lib/data";
import { formatDay, publicationChanged, publicationSummary, publishedRevisionNo, sequenceTitle } from "../lib/publishing";
import type { Publication, Revision, Sequence, Tanka } from "../lib/types";
import { AddToSequenceSheet } from "./library";
import { ConfirmDialog, formatDate } from "./ui";

/** 区画（見出し付き）。 */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** つながり・履歴の1行。to があれば移動用のリンクにする。 */
export function LinkRow({ chip, title, sub, stale, to }: { chip?: string; title: ReactNode; sub?: ReactNode; stale?: boolean; to?: string }) {
  const body = (
    <>
      {chip && <span className="chip outline" style={{ flexShrink: 0 }}>{chip}</span>}
      <span className="what">
        <span className="t">{title}</span>
        {sub && <span className={stale ? "s stale" : "s"}>{sub}</span>}
      </span>
      {to && <span aria-hidden="true" style={{ color: "var(--placeholder)" }}>›</span>}
    </>
  );
  return to ? <Link to={to} className="linked-row">{body}</Link> : <div className="linked-row">{body}</div>;
}

/** つながりの行の入れ物。行がなければ点線の枠に一言出す。 */
export function LinkRows({ empty, children }: { empty: string; children: ReactNode[] }) {
  const rows = children.filter(Boolean);
  if (rows.length === 0) return <p className="detail-empty">{empty}</p>;
  return <div className="linked-rows detail-rows">{rows}</div>;
}

/** 履歴の「作った日・直した日」など。 */
export function InfoRows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="detail-info">
      {rows.map(([k, v]) => (
        <div key={k}>
          <span className="muted">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** いちばん下の削除。消えるものと残るものは確認のポップアップでだけ伝え、ここには注記を付けない。 */
export function DangerFooter({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="detail-danger">
      <button type="button" onClick={onClick}>{label}</button>
    </div>
  );
}

/** 連作の削除の確認。題と歌の数、消えるもの・残るもの。 */
export function DeleteSequenceDialog({ title, count, busy, onConfirm, onCancel }: { title: string; count: number; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog title="この連作を削除しますか？" confirmLabel="連作を削除する" busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
      <p className="quote plain"><strong>{sequenceTitle({ title })}</strong> · {count}首</p>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
        連作の題と歌の並びが削除されます。<strong>削除すると元に戻せません。</strong>
      </p>
      <p className="small muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
        {count > 0 ? `中の短歌（${count}首）と、この連作を出した発表記録は消えません。` : "この連作を出した発表記録は消えません。"}
      </p>
    </ConfirmDialog>
  );
}

/** 発表記録の削除の確認。出し先・出した日・中身、消えるもの・残るもの。 */
export function DeletePublicationDialog({ pub, busy, onConfirm, onCancel }: { pub: Publication; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog title="この記録を削除しますか？" confirmLabel="記録を削除する" busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
      <p className="quote plain">
        <strong>{pub.destination}</strong> · {formatDay(pub.submittedOn, "short")}
        <br />
        {publicationSummary(pub)}
      </p>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
        出し先・出した日・メモと、出したときの本文の写しが削除されます。<strong>削除すると元に戻せません。</strong>
      </p>
      <p className="small muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>短歌と連作は消えません。</p>
    </ConfirmDialog>
  );
}

// --- 短歌（チェック結果） -----------------------------------------------------

/** 短歌のつながり：その歌の発表記録と、入っている連作。 */
export function TankaRelations({ tanka, rev }: { tanka: Tanka; rev: Revision }) {
  const { user } = useAuth();
  const { data: pubs } = useTankaPublications(user?.uid, tanka.id);
  const { data: sequences } = useSequences(user?.uid);
  const mine = sequences.filter((s) => s.items.some((i) => i.tankaId === tanka.id));
  return (
    <DetailSection title="つながり">
      <LinkRows empty="発表記録と連作はまだありません">
        {[
          ...pubs.map((p) => {
            const no = publishedRevisionNo(p, tanka.id);
            const what = p.sequenceId ? `連作「${p.sequenceTitle || "無題"}」で第${no}稿を出した` : `第${no}稿を出した`;
            return <LinkRow key={p.id} chip="発表記録" title={p.destination} sub={`${formatDay(p.submittedOn, "short")} · ${what}`} to={`/publications/${p.id}`} />;
          }),
          ...mine.map((s) => <SequenceRow key={s.id} seq={s} tanka={tanka} rev={rev} />),
        ]}
      </LinkRows>
    </DetailSection>
  );
}

function SequenceRow({ seq, tanka, rev }: { seq: Sequence; tanka: Tanka; rev: Revision }) {
  const item = seq.items.find((i) => i.tankaId === tanka.id);
  const { data: inside } = useRevision(tanka.id, item?.revisionId);
  const stale = Boolean(item && item.revisionId !== tanka.currentRevisionId);
  const sub = !inside
    ? undefined
    : stale
      ? `連作には第${inside.revisionNo}稿が入っています（いまの稿は第${tanka.latestRevisionNo}稿）`
      : item?.revisionId === rev.id
        ? "この稿が入っています"
        : `第${inside.revisionNo}稿が入っています`;
  return <LinkRow chip="連作" title={sequenceTitle(seq)} sub={sub} stale={stale} to={`/sequences/${seq.id}`} />;
}

/** 短歌の履歴：全N稿（推敲履歴と比較へ）。 */
export function TankaHistory({ tankaId }: { tankaId: string }) {
  const { data: revisions } = useRevisions(tankaId);
  const first = revisions[0];
  return (
    <DetailSection title="履歴">
      <div className="linked-rows detail-rows">
        <LinkRow
          chip="稿"
          title={`全${revisions.length}稿`}
          sub={first ? `第1稿 ${formatDay(isoDay(first.createdAt), "short")} から · 推敲履歴と比較` : "推敲履歴と比較"}
          to={`/t/${tankaId}/history`}
        />
      </div>
    </DetailSection>
  );
}

/** 短歌の操作：この稿から推敲する・発表を記録・連作に入れる（いまの稿でなければ「この稿に戻す」も）。 */
export function TankaActions({ tanka, rev, onRestore, restoring }: { tanka: Tanka; rev: Revision; onRestore?: () => void; restoring?: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <DetailSection title="操作">
      <div className="detail-actions">
        <Link to={`/t/${tanka.id}/edit?from=${rev.id}`} className="btn-primary">この稿から推敲する</Link>
        <div className="row">
          <Link to={`/publish?t=${tanka.id}&r=${rev.id}`} className="btn-secondary">発表を記録</Link>
          <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>連作に入れる</button>
        </div>
        {onRestore && (
          <>
            <button type="button" className="btn-secondary" disabled={restoring} onClick={onRestore}>この稿に戻す</button>
            <p className="hint" style={{ textAlign: "center" }}>この稿はいまの稿ではありません。ここから枝分かれして推敲するか、この稿に戻していまの稿にできます。</p>
          </>
        )}
      </div>
      {adding && <AddToSequenceSheet tanka={tanka} onClose={() => setAdding(false)} />}
    </DetailSection>
  );
}

// --- 連作 -------------------------------------------------------------------

/** 連作のつながり：この連作を出した発表記録。 */
export function SequenceRelations({ seq }: { seq: Sequence }) {
  const { user } = useAuth();
  const { data: pubs } = useSequencePublications(user?.uid, seq.id);
  return (
    <DetailSection title="つながり">
      <LinkRows empty="この連作を出した発表記録はまだありません">
        {pubs.map((p) => {
          const changed = publicationChanged(p, seq);
          return (
            <LinkRow
              key={p.id}
              chip="発表記録"
              title={p.destination}
              sub={`${formatDay(p.submittedOn, "short")} · ${p.items.length}首を出した${changed ? " · 出した後に変更があります" : ""}`}
              stale={changed}
              to={`/publications/${p.id}`}
            />
          );
        })}
      </LinkRows>
    </DetailSection>
  );
}

// --- 発表記録 ---------------------------------------------------------------

/** 発表記録の写しの1首。いまの稿を開く・出した後に推敲しているか・削除した歌。 */
export function PublishedItem({ no, item, tanka, many }: { no: string; item: Publication["items"][number]; tanka: Tanka | undefined; many: boolean }) {
  const revisedAfter = tanka?.currentRevisionId && tanka.currentRevisionId !== item.revisionId;
  return (
    <li>
      {many && <span className="num">{no}</span>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <p className={tanka ? "poem" : "poem gone"}>{item.body}</p>
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="small muted">第{item.revisionNo}稿{revisedAfter && " · 出した後に推敲しています"}</span>
          {tanka ? (
            <Link to={`/t/${tanka.id}/r/${tanka.currentRevisionId}`} className="small" style={{ fontWeight: 500, fontSize: 13, textDecoration: "none" }}>いまの稿を開く</Link>
          ) : (
            <span className="chip outline">削除した歌</span>
          )}
        </span>
      </div>
    </li>
  );
}

/** 発表記録のつながり：出した連作（いまの連作を開く）。 */
export function PublicationRelations({ pub }: { pub: Publication }) {
  const { user } = useAuth();
  const { data: sequences, loading } = useSequences(user?.uid);
  if (!pub.sequenceId) return null;
  const seq = sequences.find((s) => s.id === pub.sequenceId);
  const changed = seq ? publicationChanged(pub, seq) : false;
  return (
    <DetailSection title="つながり">
      <div className="linked-rows detail-rows">
        {seq ? (
          <LinkRow
            chip="連作"
            title={sequenceTitle(seq)}
            sub={`いまの連作を開く${changed ? " · 出した後に変更があります" : ""}`}
            stale={changed}
            to={`/sequences/${seq.id}`}
          />
        ) : (
          <LinkRow chip="連作" title={pub.sequenceTitle || "無題の連作"} sub={loading ? "" : "削除した連作"} />
        )}
      </div>
    </DetailSection>
  );
}

/** 発表記録の履歴：記録した日・直した日。 */
export function PublicationHistory({ pub }: { pub: Publication }) {
  const edited = pub.updatedAt.getTime() - pub.createdAt.getTime() > 1000;
  const rows: [string, string][] = [["記録した日", formatDate(pub.createdAt)]];
  if (edited) rows.push(["直した日", formatDate(pub.updatedAt)]);
  return (
    <DetailSection title="履歴">
      <InfoRows rows={rows} />
    </DetailSection>
  );
}

function isoDay(d: Date): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 連作から歌を外した直後に出す「元に戻す」。数秒で消え、そのとき保存する。 */
export function UndoBar({ tanka, onUndo }: { tanka: Tanka | undefined; onUndo: () => void }) {
  const body = tanka?.latestBody ?? "";
  return (
    <div className="undo-bar" role="status" aria-live="polite">
      <span>「{body.length > 8 ? `${body.slice(0, 8)}…` : body}」を外しました</span>
      <button type="button" onClick={onUndo}>元に戻す</button>
    </div>
  );
}
