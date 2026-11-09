// 設定のデータの欄（スマホ・PC）で使う文言と確認
import { ConfirmDialog } from "./ui";

/** 書き出しで何が入るか（書き出しの確認で伝える）。 */
export const EXPORT_NOTE = "短歌とすべての稿、チェック結果、「意図的」「誤検出」にした判断、読まれ方、連作、発表記録を、JSONファイル1つにまとめて書き出します。";

/** 「すべてのデータを書き出す」を押したあとの確認。 */
export function ExportDialog({ busy, onConfirm, onCancel }: { busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog title="すべてのデータを書き出しますか？" confirmLabel="書き出す" tone="primary" busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>{EXPORT_NOTE}</p>
    </ConfirmDialog>
  );
}

/** アカウント削除の確認で、消えるものを伝える。 */
export function DeleteAccountText() {
  return (
    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
      すべての短歌と稿、チェック結果、「意図的」「誤検出」にした指摘、読まれ方、連作、発表記録、ログイン情報が削除されます。
      <strong>削除すると元に戻せません。</strong>必要なら、先に「すべてのデータを書き出す」で保存してください。
    </p>
  );
}
