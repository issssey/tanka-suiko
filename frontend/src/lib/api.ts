// 書き込みと処理は Cloud Run の API を通す。読み取りは Firestore を直接読む（data.ts）。
import { auth } from "./firebase";
import type { Feedback, Orthography, PreprocessResponse, Publication, SaveResponse, Sequence, Style } from "./types";

const BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, "ログインしてください");
  const token = await user.getIdToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "通信に失敗しました";
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
    } catch {
      /* noop */
    }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export function createTanka() {
  return request<{ tankaId: string }>("POST", "/tankas");
}

/** 短歌を削除する。すべての稿・チェック結果・作者の判断をまとめて消す（元に戻せない）。 */
export function deleteTanka(tankaId: string) {
  return request<void>("DELETE", `/tankas/${tankaId}`);
}

/** 自分のすべての短歌と稿を JSON で書き出し、ファイルとして保存させる。 */
export async function downloadExport() {
  const data = await request<unknown>("GET", "/me/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `suikocho-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 鑑賞を頼む。新しく頼んだら pending が返り、結果は Firestore を購読して受け取る。1日の上限を超えたら 429。 */
export function requestAppreciation(tankaId: string, revisionId: string) {
  return request<unknown>("POST", `/tankas/${tankaId}/revisions/${revisionId}/appreciation`);
}

/** 伝えたかったこと（作者のメモ）を保存する。 */
export function saveAppreciationNote(tankaId: string, revisionId: string, note: string) {
  return request<unknown>("PATCH", `/tankas/${tankaId}/revisions/${revisionId}/appreciation/note`, { note });
}

/** アカウント削除。すべての短歌を削除し、ログイン情報も消す。 */
export function deleteAccount() {
  return request<void>("DELETE", "/me");
}

export function preprocess(
  tankaId: string,
  body: string,
  opts: { style?: Style; orthography?: Orthography; readingOverrides?: Record<string, string> } = {},
) {
  return request<PreprocessResponse>("POST", `/tankas/${tankaId}/preprocess`, { body, ...opts });
}

export interface SaveRevisionInput {
  parentRevisionId: string | null;
  body: string;
  segments: { no: number; text: string; reading: string }[];
  style: Style;
  orthography: Orthography;
  note: string | null;
  readingChoices: Record<string, string>;
}

export function saveRevision(tankaId: string, input: SaveRevisionInput) {
  return request<SaveResponse>("POST", `/tankas/${tankaId}/revisions`, input);
}

/** 「この稿に戻す」。同じ内容の稿を新しく保存し、いまの稿にする。 */
export function restoreRevision(tankaId: string, revisionId: string) {
  return request<SaveResponse>("POST", `/tankas/${tankaId}/revisions/${revisionId}/restore`);
}

export function recheck(tankaId: string, revisionId: string) {
  return request<SaveResponse>("POST", `/tankas/${tankaId}/revisions/${revisionId}/recheck`);
}

export function putFeedback(tankaId: string, fingerprint: string, status: Feedback["status"], revisionId: string) {
  return request<Feedback>("PUT", `/tankas/${tankaId}/feedback/${encodeURIComponent(fingerprint)}`, { status, revisionId });
}

export function deleteFeedback(tankaId: string, fingerprint: string) {
  return request<void>("DELETE", `/tankas/${tankaId}/feedback/${encodeURIComponent(fingerprint)}`);
}

// --- 連作 ---
export interface SequenceInput {
  title: string;
  /** revisionId を省くと、その時点のいまの稿を入れる */
  items: { tankaId: string; revisionId?: string | null }[];
  note?: string | null;
}

export function createSequence(input: SequenceInput) {
  return request<Sequence>("POST", "/sequences", input);
}

export function updateSequence(sequenceId: string, input: SequenceInput) {
  return request<Sequence>("PUT", `/sequences/${sequenceId}`, input);
}

/** 連作を削除する。中の短歌と発表記録は消えない。 */
export function deleteSequence(sequenceId: string) {
  return request<void>("DELETE", `/sequences/${sequenceId}`);
}

// --- 発表記録 ---
export interface PublicationFields {
  destination: string;
  submittedOn: string;
  note: string | null;
}

/** 二重投稿の確認。同じ短歌（稿が違っても）を含む発表記録を返す。 */
export async function checkPublications(tankaIds: string[]) {
  const res = await request<{ publications: Publication[] }>("POST", "/publications/check", { tankaIds });
  return res.publications;
}

export function createPublication(
  input: PublicationFields & ({ items: { tankaId: string; revisionId: string }[] } | { sequenceId: string }),
) {
  return request<Publication>("POST", "/publications", input);
}

/** 出し先・出した日・フリーテキストを直す。中身の稿は直せない。 */
export function updatePublication(publicationId: string, input: PublicationFields) {
  return request<Publication>("PUT", `/publications/${publicationId}`, input);
}

export function deletePublication(publicationId: string) {
  return request<void>("DELETE", `/publications/${publicationId}`);
}
