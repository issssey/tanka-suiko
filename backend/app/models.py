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
