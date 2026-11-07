from datetime import UTC, datetime

from app.models import Revision
from app.preprocess.pipeline import ConfirmedSegment, build_from_confirmed, preprocess


def make_revision(body: str, *, rev_id: str = "r1", no: int = 1, parent: str | None = None,
                  readings: dict[int, str] | None = None, texts: list[str] | None = None,
                  style: str | None = None, orthography: str | None = None) -> Revision:
    """前処理の結果をそのまま確定した推敲版を作る。texts で句分けを、readings で読みを上書きできる。"""
    pre = preprocess(body, style=style, orthography=orthography)
    segs = []
    if texts:
        joined = "".join(texts)
        assert joined == pre.bodyNormalized, (joined, pre.bodyNormalized)
        # 読みは前処理の形態素から句ごとに組み立てる
        pos = 0
        for i, t in enumerate(texts, start=1):
            start, end = pos, pos + len(t)
            reading = "".join(tok.reading for tok in pre.tokens if start <= tok.span[0] < end)
            segs.append(ConfirmedSegment(i, t, (readings or {}).get(i, reading)))
            pos = end
    else:
        for s in pre.segments:
            segs.append(ConfirmedSegment(s.no, s.text, (readings or {}).get(s.no, s.reading)))
    built = build_from_confirmed(body, segs, style=pre.style)
    return Revision(
        id=rev_id,
        revisionNo=no,
        parentRevisionId=parent,
        body=body,
        bodyNormalized=built.bodyNormalized,
        reading=built.reading,
        orthography=pre.orthography,
        style=pre.style,
        segments=built.segments,
        tokens=built.tokens,
        createdAt=datetime.now(UTC),
    )
