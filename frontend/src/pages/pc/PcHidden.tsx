import { useParams, useSearchParams } from "react-router-dom";
import { useTanka } from "../../lib/data";
import { PcShell } from "../../components/pc";
import { Loading } from "../../components/ui";
import PcResult from "./PcResult";

/** 非表示にした指摘（PC版）。チェック結果の右の列に出す。どの稿の画面から来たかは ?r= で受け取る。 */
export default function PcHidden() {
  const { tankaId = "" } = useParams();
  const [params] = useSearchParams();
  const { data: tanka, loading } = useTanka(tankaId);
  const revisionId = params.get("r") ?? tanka?.currentRevisionId ?? null;
  if (!revisionId) return <PcShell activeTankaId={tankaId}>{loading ? <Loading /> : <div className="center-msg">短歌が見つかりません。</div>}</PcShell>;
  return <PcResult mode="hidden" revisionIdOverride={revisionId} />;
}
