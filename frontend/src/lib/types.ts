// Firestore のドキュメントと API の入出力の型（backend/app/models.py と対応）

export type Severity = "high" | "medium" | "low";
export type Transition = "new" | "continued";
export type RunStatus = "queued" | "running" | "done" | "skipped" | "failed" | "limited";
export type Style = "colloquial" | "literary";
export type Orthography = "modern" | "historical";

export interface Segment {
  no: number;
  text: string;
  reading: string;
  mora: number;
  expected: number;
  span: [number, number];
}

export interface Token {
  index: number;
  surface: string;
  lemma: string;
  pos: string[];
  reading: string;
  mora: number;
  span: [number, number];
  segmentNo: number | null;
  oov: boolean;
}

export interface Finding {
  code: string;
  severity: Severity;
  confidence: number;
  segmentNo: number | null;
  span: [number, number] | null;
  matchedText: string | null;
  message: string;
  evidence: Record<string, unknown>;
  fingerprint: string;
  transition: Transition;
}

/** 短歌1首。題は持たず、一覧では最新の稿の本文（latestBody）で見分ける。 */
export interface Tanka {
  id: string;
  authorId: string;
  currentRevisionId: string | null;
  latestBody: string | null;
  latestRevisionNo: number | null;
  deletedAt: Date | null;
  nextRevisionNo: number;
  readingMemory: Record<string, string>;
  /** 発表記録の件数 */
  publishedCount?: number;
  /** 入っている連作 */
  sequenceIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Revision {
  id: string;
  revisionNo: number;
  parentRevisionId: string | null;
  body: string;
  bodyNormalized: string;
  reading: string;
  orthography: Orthography;
  style: Style;
  segments: Segment[];
  tokens: Token[];
  note: string | null;
  /** 「この稿に戻す」で作った稿なら、戻した先の稿（＝親）の ID */
  restoredFromRevisionId?: string | null;
  createdAt: Date;
}

export interface CheckRun {
  id: string;
  phase: "sync" | "async";
  baseRevisionId: string | null;
  status: RunStatus;
  trigger: "save" | "recheck";
  findings: Finding[];
  resolvedFingerprints: string[];
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface Feedback {
  fingerprint: string;
  status: "intentional" | "false_positive";
  comment: string | null;
  revisionNo: number | null;
  createdAt: Date;
}

export interface ReadingCandidate {
  tokenIndex: number;
  surface: string;
  readings: string[];
  selected: string;
}

export interface PreprocessResponse {
  bodyNormalized: string;
  hints: number[];
  style: Style;
  orthography: Orthography;
  detectedStyle: Style;
  detectedOrthography: Orthography;
  segments: Segment[];
  tokens: Token[];
  candidates: ReadingCandidate[];
  unknownWords: { tokenIndex: number; surface: string; reading: string }[];
  totalMora: number;
}

export interface SaveResponse {
  revisionId: string;
  revisionNo: number;
  syncRun: { runId: string; findings: Finding[]; resolvedFingerprints: string[] };
  asyncRunId: string;
  asyncRunStatus: RunStatus;
}

/** 連作。題と歌の並びを持つ作品の単位。歌は入れた時点の稿を指す。 */
export interface Sequence {
  id: string;
  authorId: string;
  title: string;
  items: { tankaId: string; revisionId: string }[];
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 発表記録。出した時点の稿と本文、連作の題を写して持つ。 */
export interface Publication {
  id: string;
  authorId: string;
  destination: string;
  /** YYYY-MM-DD */
  submittedOn: string;
  note: string | null;
  sequenceId: string | null;
  sequenceTitle: string | null;
  items: { tankaId: string; revisionId: string; revisionNo: number; body: string }[];
  tankaIds: string[];
  createdAt: Date;
  updatedAt: Date;
}
