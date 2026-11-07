// Firestore のリアルタイムリスナー。非同期の指摘が書き込まれたら画面に自動で出る。
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import type { CheckRun, Feedback, Revision, Tanka } from "./types";

export interface Loadable<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

function convert(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as DocumentData).map(([k, v]) => [k, convert(v)]));
  }
  return value;
}

function fromDoc<T>(id: string, data: DocumentData): T {
  return { ...(convert(data) as object), id } as T;
}

function useSnapshot<T>(subscribe: ((set: (v: T) => void, fail: (e: Error) => void) => () => void) | null, initial: T, deps: unknown[]): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: initial, loading: subscribe !== null, error: null });
  useEffect(() => {
    if (!subscribe) {
      setState({ data: initial, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return subscribe(
      (data) => setState({ data, loading: false, error: null }),
      (error) => setState((s) => ({ ...s, loading: false, error })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useTankas(uid: string | undefined): Loadable<Tanka[]> {
  return useSnapshot<Tanka[]>(
    uid
      ? (set, fail) =>
          onSnapshot(
            // deletedAt == null を付けないとセキュリティルールで拒否される（削除中の短歌は読めない）
            query(
              collection(db, "tankas"),
              where("authorId", "==", uid),
              where("deletedAt", "==", null),
              orderBy("updatedAt", "desc"),
            ),
            (snap) => set(snap.docs.map((d) => fromDoc<Tanka>(d.id, d.data()))),
            fail,
          )
      : null,
    [],
    [uid],
  );
}

export function useTanka(tankaId: string | undefined): Loadable<Tanka | null> {
  return useSnapshot<Tanka | null>(
    tankaId
      ? (set, fail) =>
          onSnapshot(doc(db, "tankas", tankaId), (d) => set(d.exists() ? fromDoc<Tanka>(d.id, d.data()) : null), fail)
      : null,
    null,
    [tankaId],
  );
}

export function useRevision(tankaId: string | undefined, revisionId: string | null | undefined): Loadable<Revision | null> {
  return useSnapshot<Revision | null>(
    tankaId && revisionId
      ? (set, fail) =>
          onSnapshot(
            doc(db, "tankas", tankaId, "revisions", revisionId),
            (d) => set(d.exists() ? fromDoc<Revision>(d.id, d.data()) : null),
            fail,
          )
      : null,
    null,
    [tankaId, revisionId],
  );
}

export function useRevisions(tankaId: string | undefined): Loadable<Revision[]> {
  return useSnapshot<Revision[]>(
    tankaId
      ? (set, fail) =>
          onSnapshot(
            query(collection(db, "tankas", tankaId, "revisions"), orderBy("revisionNo", "asc")),
            (snap) => set(snap.docs.map((d) => fromDoc<Revision>(d.id, d.data()))),
            fail,
          )
      : null,
    [],
    [tankaId],
  );
}

export function useCheckRuns(tankaId: string | undefined, revisionId: string | null | undefined): Loadable<CheckRun[]> {
  return useSnapshot<CheckRun[]>(
    tankaId && revisionId
      ? (set, fail) =>
          onSnapshot(
            query(collection(db, "tankas", tankaId, "revisions", revisionId, "checkRuns"), orderBy("startedAt", "asc")),
            (snap) => set(snap.docs.map((d) => fromDoc<CheckRun>(d.id, d.data()))),
            fail,
          )
      : null,
    [],
    [tankaId, revisionId],
  );
}

/** 複数の版の checkRuns をまとめて購読する（履歴・比較・指摘の経過で使う）。 */
export function useRunsByRevision(tankaId: string | undefined, revisionIds: string[]): Record<string, CheckRun[]> {
  const [runs, setRuns] = useState<Record<string, CheckRun[]>>({});
  const key = revisionIds.join(",");
  useEffect(() => {
    if (!tankaId || revisionIds.length === 0) {
      setRuns({});
      return;
    }
    const unsubs = revisionIds.map((rid) =>
      onSnapshot(
        query(collection(db, "tankas", tankaId, "revisions", rid, "checkRuns"), orderBy("startedAt", "asc")),
        (snap) => setRuns((prev) => ({ ...prev, [rid]: snap.docs.map((d) => fromDoc<CheckRun>(d.id, d.data())) })),
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tankaId, key]);
  return runs;
}

export function useFeedback(tankaId: string | undefined): Loadable<Feedback[]> {
  return useSnapshot<Feedback[]>(
    tankaId
      ? (set, fail) =>
          onSnapshot(
            collection(db, "tankas", tankaId, "feedback"),
            (snap) => set(snap.docs.map((d) => ({ ...(convert(d.data()) as Feedback), fingerprint: d.id }))),
            fail,
          )
      : null,
    [],
    [tankaId],
  );
}
