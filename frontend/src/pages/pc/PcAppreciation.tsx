// 鑑賞（PC）。左に短歌の一覧、中央に鑑賞（場面・気持ち・立ち止まった箇所と、割れそうな箇所を2列に）。
import { Link, useParams } from "react-router-dom";
import { AppreciationBody, AppreciationNotReady } from "../../components/appreciation";
import { PcShell } from "../../components/pc";
import { Loading, formatDate } from "../../components/ui";
import { useAppreciation, useRevision } from "../../lib/data";

export default function PcAppreciation() {
  const { tankaId = "", revisionId = "" } = useParams();
  const { data: rev, loading } = useRevision(tankaId, revisionId);
  const { data: a, loading: loadingA } = useAppreciation(tankaId, revisionId);
  const back = `/t/${tankaId}/r/${revisionId}`;
  if (loading || loadingA) return <PcShell activeTankaId={tankaId}><Loading /></PcShell>;
  if (!rev) return <PcShell activeTankaId={tankaId}><div className="center-msg">この稿は見つかりません。<Link to="/">一覧へ</Link></div></PcShell>;
  return (
    <PcShell activeTankaId={tankaId}>
      <div className="pc-titlebar">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1>鑑賞</h1>
          <span className="meta">第{rev.revisionNo}稿{a?.status === "done" && ` · ${formatDate(a.createdAt)}`}</span>
        </div>
        <Link to={back} className="pc-btn">チェック結果に戻る</Link>
      </div>
      {a?.status === "done" ? <AppreciationBody tankaId={tankaId} rev={rev} a={a} pc /> : <AppreciationNotReady tankaId={tankaId} rev={rev} a={a} />}
    </PcShell>
  );
}
