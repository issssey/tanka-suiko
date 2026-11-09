"""ドメインモデル。Firestoreのドキュメントの形と、APIの入出力を兼ねる。

フィールド名は設計書の「データモデル（Firestore）」に合わせてcamelCaseにする。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Style = Literal["colloquial", "literary"]
Orthography = Literal["modern", "historical"]
Severity = Literal["high", "medium", "low"]
Transition = Literal["new", "continued"]
Phase = Literal["sync", "async"]
RunStatus = Literal["queued", "running", "done", "skipped", "failed", "limited"]
FeedbackStatus = Literal["intentional", "false_positive"]

EXPECTED_MORA = (5, 7, 5, 7, 7)


class Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class Token(Model):
    """番号付きの形態素。LLMは該当箇所をこの番号で答える。"""

    index: int
    surface: str
    lemma: str
    pos: list[str]
    reading: str  # ひらがな
    mora: int
    span: tuple[int, int]  # bodyNormalized 上の文字位置 [start, end)
    segmentNo: int | None = None
    oov: bool = False


class Segment(Model):
    no: int
    text: str
    reading: str
    mora: int
    expected: int
    span: tuple[int, int]


class Finding(Model):
    code: str
    severity: Severity
    confidence: float = 1.0
    segmentNo: int | None = None
    span: tuple[int, int] | None = None
    matchedText: str | None = None
    message: str
    evidence: dict = Field(default_factory=dict)
    fingerprint: str
    transition: Transition = "new"


class Tanka(Model):
    """短歌1首。題は持たず、一覧では最新の稿の本文（latestBody）で見分ける。"""

    id: str
    authorId: str
    currentRevisionId: str | None = None
    latestBody: str | None = None  # 一覧表示用に最新の稿の本文を複製
    latestRevisionNo: int | None = None
    nextRevisionNo: int = 1
    readingMemory: dict[str, str] = Field(default_factory=dict)
    createdAt: datetime
    updatedAt: datetime
    deletedAt: datetime | None = None  # 削除処理中の目印
    publishedCount: int = 0  # 発表記録の件数（発表記録の書き込みと同じトランザクションで更新）
    sequenceIds: list[str] = Field(default_factory=list)  # 入っている連作（連作の書き込みと同じトランザクションで更新）


class Revision(Model):
    id: str
    revisionNo: int
    parentRevisionId: str | None = None
    body: str
    bodyNormalized: str
    reading: str
    orthography: Orthography
    style: Style
    segments: list[Segment]
    tokens: list[Token]
    note: str | None = None
    restoredFromRevisionId: str | None = None  # 「この稿に戻す」で作った稿なら、戻した先の稿（＝親）
    createdAt: datetime


class CheckRun(Model):
    id: str
    phase: Phase
    baseRevisionId: str | None = None
    rulesetVersion: str
    llmModel: str | None = None
    promptVersion: str | None = None
    status: RunStatus
    trigger: Literal["save", "recheck"] = "save"
    findings: list[Finding] = Field(default_factory=list)
    resolvedFingerprints: list[str] = Field(default_factory=list)
    reusedFromRunId: str | None = None
    error: str | None = None
    startedAt: datetime
    finishedAt: datetime | None = None


class Feedback(Model):
    fingerprint: str
    status: FeedbackStatus
    comment: str | None = None
    revisionNo: int | None = None  # どの稿のチェック結果で設定したか（表示用）
    createdAt: datetime


# --- 連作と発表 ---
MAX_SEQUENCE_ITEMS = 100
MAX_DESTINATIONS = 50


class SequenceItem(Model):
    tankaId: str
    revisionId: str  # 入れた時点の稿。後で推敲しても自動では差し替えない


class Sequence(Model):
    """連作。題と歌の並びを持つ作品の単位。発表とは独立に作って直せる。"""

    id: str
    authorId: str
    title: str = ""
    items: list[SequenceItem] = Field(default_factory=list)
    note: str | None = None
    createdAt: datetime
    updatedAt: datetime


class PublicationItem(Model):
    """出した時点の稿と本文の写し。短歌を削除しても、記録だけで何を出したか分かる。"""

    tankaId: str
    revisionId: str
    revisionNo: int
    body: str


class Publication(Model):
    """発表記録。どの稿を、どこに、いつ出したか。1首でも連作でも、1回出したら1件。"""

    id: str
    authorId: str
    destination: str
    submittedOn: str  # YYYY-MM-DD
    note: str | None = None
    sequenceId: str | None = None
    sequenceTitle: str | None = None  # 出した時点の題の写し
    items: list[PublicationItem]
    tankaIds: list[str]  # 二重投稿の検索用（array-contains）
    createdAt: datetime
    updatedAt: datetime


# --- 鑑賞 ---
AppreciationStatus = Literal["pending", "done", "failed"]


class AppreciationPause(Model):
    """立ち止まった箇所。語句は形態素の番号で受け取り、文字位置と文字列はサーバー側で復元する。"""

    tokenStart: int
    tokenEnd: int
    span: tuple[int, int]
    text: str
    reason: str


class AppreciationSplit(Model):
    """読みが割れそうな箇所と、考えられる読み（2〜3通り）。"""

    tokenStart: int
    tokenEnd: int
    span: tuple[int, int]
    text: str
    readings: list[str]


class Appreciation(Model):
    """作者が頼んだ稿の鑑賞（短歌を読み慣れた読み手がどう読むか）。1稿1件。評価や改作案は持たない。"""

    revisionId: str
    status: AppreciationStatus
    reader: Literal["experienced"] = "experienced"
    promptVersion: str | None = None
    llmModel: str | None = None
    scene: str | None = None
    feeling: str | None = None
    pauses: list[AppreciationPause] = Field(default_factory=list)
    splits: list[AppreciationSplit] = Field(default_factory=list)
    authorNote: str | None = None  # 伝えたかったこと（作者のメモ。LLMには渡さない）
    error: str | None = None
    createdAt: datetime
    updatedAt: datetime
