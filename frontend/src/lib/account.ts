// 設定画面の「データ」の操作（スマホ・PC共通）
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteAccount, downloadExport } from "./api";
import { logout } from "./auth";

export function useAccountActions() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    exportAll: async () => {
      setBusy("export");
      setError(null);
      try {
        await downloadExport();
      } catch (e) {
        setError(e instanceof Error ? e.message : "書き出せませんでした");
      } finally {
        setBusy(null);
      }
    },
    removeAccount: async () => {
      setBusy("delete");
      setError(null);
      try {
        await deleteAccount();
        await logout().catch(() => undefined);
        navigate("/login", { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "削除できませんでした");
        setBusy(null);
        throw e;
      }
    },
  };
}
