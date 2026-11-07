// チェック結果の画面での操作（スマホ・PC共通）
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteFeedback, deleteTanka, putFeedback, recheck } from "./api";

export function useRevisionActions(tankaId: string, revisionId: string) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, fallback: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    error,
    judge: (fingerprint: string, status: "intentional" | "false_positive") =>
      run(fingerprint, () => putFeedback(tankaId, fingerprint, status, revisionId), "保存できませんでした"),
    undo: (fingerprint: string) => run(fingerprint, () => deleteFeedback(tankaId, fingerprint), "取り消せませんでした"),
    recheck: () => run("recheck", () => recheck(tankaId, revisionId), "再チェックできませんでした"),
    remove: async () => {
      if (await run("delete", () => deleteTanka(tankaId), "削除できませんでした")) navigate("/", { replace: true });
    },
  };
}
