import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useTankas } from "../../lib/data";
import { PcShell } from "../../components/pc";
import { Loading, PlusIcon } from "../../components/ui";

/**
 * PC版の「短歌」。一覧の画面は持たず、最近推敲した歌のチェック結果を開く
 * （左の列に短歌の一覧と検索がある）。歌がまだなければ「はじめて」を出す。
 */
export default function PcHome() {
  const { user } = useAuth();
  const { data: tankas, loading } = useTankas(user?.uid);
  const first = tankas.find((t) => t.currentRevisionId);
  if (loading) return <PcShell><Loading /></PcShell>;
  if (first) return <Navigate to={`/t/${first.id}/r/${first.currentRevisionId}`} replace />;
  return (
    <PcShell>
      <PcEmpty />
    </PcShell>
  );
}

function PcEmpty() {
  const steps = [
    ["歌を書く", "一行でも、句ごとに区切っても構いません。文語・旧仮名の歌も書けます。"],
    ["読みを確かめる", "書きながら、右側に読みと句の区切り、モーラ数が出ます。違っていれば直せます。"],
    ["指摘を見て、推敲する", "直すかどうかはあなたが決めます。意図的なものは「意図的」にしておけます。"],
  ];
  return (
    <div className="pc-empty">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 30, fontWeight: 600 }}>まだ短歌がありません</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 560, fontSize: 15, lineHeight: 1.8 }}>
          一首を書いて保存するたびに、つまずきを指摘します。推敲を重ねると、どの指摘が解消したかが分かります。
        </p>
      </div>
      <ol className="pc-empty-steps">
        {steps.map(([title, text], i) => (
          <li key={title}>
            <span className="num">{i + 1}</span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
            <span className="small muted" style={{ fontSize: 13, lineHeight: 1.7 }}>{text}</span>
          </li>
        ))}
      </ol>
      <Link to="/new" className="btn-primary" style={{ width: "auto", padding: "0 28px" }}>
        <PlusIcon />
        最初の一首を書く
      </Link>
    </div>
  );
}
