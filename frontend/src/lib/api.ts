// 書き込みと処理は Cloud Run の API を通す。読み取りは Firestore を直接読む（data.ts）。
import { auth } from "./firebase";
import type { Feedback, Orthography, PreprocessResponse, SaveResponse, Style } from "./types";

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

export function createTanka(title: string | null) {
  return request<{ tankaId: string }>("POST", "/tankas", { title });
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

export function recheck(tankaId: string, revisionId: string) {
  return request<SaveResponse>("POST", `/tankas/${tankaId}/revisions/${revisionId}/recheck`);
}

export function putFeedback(tankaId: string, fingerprint: string, status: Feedback["status"]) {
  return request<Feedback>("PUT", `/tankas/${tankaId}/feedback/${encodeURIComponent(fingerprint)}`, { status });
}

export function deleteFeedback(tankaId: string, fingerprint: string) {
  return request<void>("DELETE", `/tankas/${tankaId}/feedback/${encodeURIComponent(fingerprint)}`);
}
