// PC版の発表を記録／記録を直す。中央のダイアログ
import { PcHeader } from "../../components/pc";
import { PublishForm } from "../../components/publish";

export default function PcPublish() {
  return (
    <div className="pc">
      <PcHeader />
      <div className="pc-modal-layer">
        <PublishForm pc />
      </div>
    </div>
  );
}
