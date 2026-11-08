// 発表記録の詳細（PC）
import { PcHeader } from "../../components/pc";
import { PublicationDetail } from "../../components/publicationDetail";

export default function PcPublication() {
  return (
    <div className="pc">
      <PcHeader />
      <PublicationDetail pc />
    </div>
  );
}
