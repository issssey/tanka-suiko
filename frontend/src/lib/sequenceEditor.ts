// 連作の編集。題・並び・差し替えは変えたらすぐ保存する（保存ボタンは置かない）。
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSequence, deleteSequence, updateSequence } from "./api";
import { useAuth } from "./auth";
import { usePublications, useTankas } from "./data";
import type { Sequence, Tanka } from "./types";

type Item = Sequence["items"][number];

export function useSequenceEditor(seq: Sequence | null) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: tankas } = useTankas(user?.uid);
  const { data: pubs } = usePublications(user?.uid);
  const tankasById = useMemo(() => new Map<string, Tanka>(tankas.map((t) => [t.id, t])), [tankas]);
  const [items, setItems] = useState<Item[]>(seq?.items ?? []);
  const [title, setTitle] = useState(seq?.title ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editingTitle = useRef(false);
  const saving = useRef(false);

  // 保存の結果（や別の端末での変更）が届いたら画面に反映する。入力中の題は上書きしない
  useEffect(() => {
    if (!seq || saving.current) return;
    setItems(seq.items);
    if (!editingTitle.current) setTitle(seq.title);
  }, [seq]);

  async function save(next: { title?: string; items?: Item[] }) {
    if (!seq) return;
    const body = { title: next.title ?? title, items: next.items ?? items, note: seq.note };
    if (next.items) setItems(next.items);
    saving.current = true;
    setBusy("save");
    setError(null);
    try {
      await updateSequence(seq.id, body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
      setItems(seq.items);
    } finally {
      saving.current = false;
      setBusy(null);
    }
  }

  async function remove() {
    if (!seq) return;
    setBusy("delete");
    try {
      await deleteSequence(seq.id);
      navigate("/sequences", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除できませんでした");
      setBusy(null);
    }
  }

  const published = seq ? pubs.some((p) => p.sequenceId === seq.id) : false;

  return {
    items,
    title,
    tankasById,
    busy,
    error,
    published,
    /** 保存の状態。変えたらすぐ保存するので、保存されたことを画面に出す */
    saveState: (busy === "save" ? "saving" : error ? "error" : "saved") as "saving" | "saved" | "error",
    savedAt: seq?.updatedAt ?? null,
    setTitle,
    titleProps: {
      value: title,
      onFocus: () => (editingTitle.current = true),
      onChange: (e: { target: { value: string } }) => setTitle(e.target.value),
      onBlur: () => {
        editingTitle.current = false;
        if (seq && title !== seq.title) void save({ title });
      },
    },
    setItems: (next: Item[]) => void save({ items: next }),
    addTanka: (tankaId: string) => {
      const t = tankasById.get(tankaId);
      if (t?.currentRevisionId) void save({ items: [...items, { tankaId, revisionId: t.currentRevisionId }] });
    },
    remove,
  };
}

/** 「新しい連作」。題のない連作を作って、その画面に移る。 */
export function useCreateSequence() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const seq = await createSequence({ title: "", items: [] });
      navigate(`/sequences/${seq.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "連作を作れませんでした");
    } finally {
      setBusy(false);
    }
  }
  return { create, busy, error };
}
