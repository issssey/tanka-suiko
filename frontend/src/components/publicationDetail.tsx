// 発表記録の詳細（スマホ）。PC版は発表記録の画面の右側で、その場で直す（pages/pc/PcPublications.tsx）。
// 区画は 見出しと情報 → 出したもの（写し）→ メモ → つながり → 履歴 → 操作 → 削除（設計書「詳細ページの構造」）
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deletePublication } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePublication, useTankas } from "../lib/data";
import { formatDay, kanjiNumber, publicationSummary } from "../lib/publishing";
import { DangerFooter, DeletePublicationDialog, DetailSection, PublicationHistory, PublicationRelations, PublishedItem } from "./detail";
import { Loading, TopBar } from "./ui";

export function PublicationDetail() {
  const { publicationId = "" } = useParams();
  const { user } = useAuth();
  const { data: pub, loading } = usePublication(publicationId);
  const { data: tankas } = useTankas(user?.uid);
  const tankasById = useMemo(() => new Map(tankas.map((t) => [t.id, t])), [tankas]);
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!pub) return <div className="center-msg">この記録は見つかりません。<Link to="/publications">発表記録へ</Link></div>;

  async function remove() {
    setBusy(true);
    try {
      await deletePublication(publicationId);
      navigate("/publications", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除できませんでした");
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <TopBar back="/publications" backLabel="発表記録に戻る" title={pub.destination} sub={`${publicationSummary(pub)} · ${formatDay(pub.submittedOn, "short")}`} />
      <DetailSection title="出したもの">
        <p className="hint">出した時点の稿と本文の写しです。後で推敲しても変わりません。</p>
        <ol className="pub-items">
          {pub.items.map((it, i) => (
            <PublishedItem key={`${it.tankaId}-${i}`} no={kanjiNumber(i + 1)} item={it} tanka={tankasById.get(it.tankaId)} many={pub.items.length > 1} />
          ))}
        </ol>
      </DetailSection>
      {pub.note && (
        <DetailSection title="メモ">
          <p className="pub-note" style={{ fontSize: 14 }}>{pub.note}</p>
        </DetailSection>
      )}
      <PublicationRelations pub={pub} />
      <PublicationHistory pub={pub} />
      <DetailSection title="操作">
        <div className="detail-actions">
          <Link to={`/publications/${pub.id}/edit`} className="btn-secondary">記録を直す</Link>
        </div>
      </DetailSection>
      {error && <p className="error">{error}</p>}
      <DangerFooter
        label="この記録を削除"
        onClick={() => setConfirmDelete(true)}
      />
      {confirmDelete && (
        <DeletePublicationDialog pub={pub} busy={busy} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
      )}
    </>
  );
}
