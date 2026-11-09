// 鑑賞（スマホ）。チェック結果の「鑑賞」の欄から開く。
import { Link, useParams } from "react-router-dom";
import { AppreciationBody, AppreciationNotReady } from "../components/appreciation";
import { Loading, TopBar, formatDate } from "../components/ui";
import { useAppreciation, useRevision } from "../lib/data";

export default function AppreciationPage() {
  const { tankaId = "", revisionId = "" } = useParams();
  const { data: rev, loading } = useRevision(tankaId, revisionId);
  const { data: a, loading: loadingA } = useAppreciation(tankaId, revisionId);
  const back = `/t/${tankaId}/r/${revisionId}`;
  if (loading || loadingA) return <Loading />;
  if (!rev) return <div className="center-msg">この稿は見つかりません。<Link to="/">一覧へ</Link></div>;
  const sub = a?.status === "done" ? `第${rev.revisionNo}稿 · ${formatDate(a.createdAt)}` : `第${rev.revisionNo}稿`;
  return (
    <>
      <TopBar back={back} backLabel="チェック結果に戻る" title="読まれ方" sub={sub} />
      <div style={{ padding: "8px 16px 40px" }}>
        {a?.status === "done" ? <AppreciationBody tankaId={tankaId} rev={rev} a={a} /> : <AppreciationNotReady tankaId={tankaId} rev={rev} a={a} />}
      </div>
    </>
  );
}
