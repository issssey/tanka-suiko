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
import type { CheckRun, Feedback, Publication, Revision, Sequence, Tanka } from "./types";

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

// 一度読んだ結果を覚えておく。画面を移って戻ったとき、「読み込み中」を挟まずにすぐ出して、裏で最新にする
const cache = new Map<string, unknown>();

/** ログアウトしたら覚えた結果を捨てる。 */
export function clearSnapshotCache() {
  cache.clear();
}

function useSnapshot<T>(
  name: string,
  subscribe: ((set: (v: T) => void, fail: (e: Error) => void) => () => void) | null,
  initial: T,
  deps: unknown[],
): Loadable<T> {
  const key = `${name}:${JSON.stringify(deps)}`;
  const [state, setState] = useState<Loadable<T>>(() =>
    subscribe && cache.has(key)
      ? { data: cache.get(key) as T, loading: false, error: null }
      : { data: initial, loading: subscribe !== null, error: null },
  );
  useEffect(() => {
    if (!subscribe) {
      setState({ data: initial, loading: false, error: null });
      return;
    }
    if (cache.has(key)) setState({ data: cache.get(key) as T, loading: false, error: null });
    else setState((s) => ({ ...s, loading: true }));
    return subscribe(
      (data) => {
        cache.set(key, data);
        setState({ data, loading: false, error: null });
      },
      (error) => setState((s) => ({ ...s, loading: false, error })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useTankas(uid: string | undefined): Loadable<Tanka[]> {
  return useSnapshot<Tanka[]>(
    "useTankas",
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
    "useTanka",
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
    "useRevision",
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
    "useRevisions",
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
    "useCheckRuns",
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
        // 短歌が削除された直後などは読めなくなる。その稿の結果は空として扱う
        () => setRuns((prev) => ({ ...prev, [rid]: [] })),
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tankaId, key]);
  return runs;
}

export function useFeedback(tankaId: string | undefined): Loadable<Feedback[]> {
  return useSnapshot<Feedback[]>(
    "useFeedback",
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

// --- 連作と発表記録（自分のものだけ。ルールで authorId を確かめるので where を必ず付ける） ---
export function useSequences(uid: string | undefined): Loadable<Sequence[]> {
  return useSnapshot<Sequence[]>(
    "useSequences",
    uid
      ? (set, fail) =>
          onSnapshot(
            query(collection(db, "sequences"), where("authorId", "==", uid), orderBy("updatedAt", "desc")),
            (snap) => set(snap.docs.map((d) => fromDoc<Sequence>(d.id, d.data()))),
            fail,
          )
      : null,
    [],
    [uid],
  );
}

export function useSequence(sequenceId: string | undefined): Loadable<Sequence | null> {
  return useSnapshot<Sequence | null>(
    "useSequence",
    sequenceId
      ? (set, fail) =>
          onSnapshot(doc(db, "sequences", sequenceId), (d) => set(d.exists() ? fromDoc<Sequence>(d.id, d.data()) : null), fail)
      : null,
    null,
    [sequenceId],
  );
}

export function usePublications(uid: string | undefined): Loadable<Publication[]> {
  return useSnapshot<Publication[]>(
    "usePublications",
    uid
      ? (set, fail) =>
          onSnapshot(
            query(collection(db, "publications"), where("authorId", "==", uid), orderBy("submittedOn", "desc")),
            (snap) => set(snap.docs.map((d) => fromDoc<Publication>(d.id, d.data()))),
            fail,
          )
      : null,
    [],
    [uid],
  );
}

export function usePublication(publicationId: string | undefined): Loadable<Publication | null> {
  return useSnapshot<Publication | null>(
    "usePublication",
    publicationId
      ? (set, fail) =>
          onSnapshot(doc(db, "publications", publicationId), (d) => set(d.exists() ? fromDoc<Publication>(d.id, d.data()) : null), fail)
      : null,
    null,
    [publicationId],
  );
}

/** その短歌を含む発表記録（稿が違っても）。 */
export function useTankaPublications(uid: string | undefined, tankaId: string | undefined): Loadable<Publication[]> {
  return useSnapshot<Publication[]>(
    "useTankaPublications",
    uid && tankaId
      ? (set, fail) =>
          onSnapshot(
            query(
              collection(db, "publications"),
              where("authorId", "==", uid),
              where("tankaIds", "array-contains", tankaId),
              orderBy("submittedOn", "desc"),
            ),
            (snap) => set(snap.docs.map((d) => fromDoc<Publication>(d.id, d.data()))),
            fail,
          )
      : null,
    [],
    [uid, tankaId],
  );
}

/** 出し先の候補（最近使った順）。 */
export function useDestinations(uid: string | undefined): Loadable<string[]> {
  return useSnapshot<string[]>(
    "useDestinations",
    uid
      ? (set, fail) =>
          onSnapshot(doc(db, "users", uid), (d) => set(((d.exists() && d.data().destinations) || []) as string[]), fail)
      : null,
    [],
    [uid],
  );
}
