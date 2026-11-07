import pytest

from app.preprocess.kana import count_morae, split_morae, to_hiragana
from app.preprocess.normalize import normalize
from app.preprocess.pipeline import ConfirmedSegment, PreprocessError, build_from_confirmed, preprocess


@pytest.mark.parametrize(
    "reading,expected",
    [
        ("ゆうぐれの", 5),
        ("きょう", 2),  # 小さい「ょ」は前の字と合わせて1
        ("がっこう", 4),  # 「っ」は1
        ("ほーむ", 3),  # 「ー」は1
        ("しんかんせん", 6),  # 「ん」は1
        ("キョー", 2),
        ("ふぁいと", 3),
        ("!?", 0),
    ],
)
def test_count_morae(reading, expected):
    assert count_morae(reading) == expected


def test_split_morae_keeps_small_kana_together():
    assert split_morae("しゃしん") == ["しゃ", "し", "ん"]


def test_to_hiragana():
    assert to_hiragana("ユウグレ・ホーム") == "ゆうぐれ・ほーむ"


def test_normalize_records_hints():
    n = normalize("  夕暮れの 駅のホームで\n寂しくて　君からの文字 何度も読み返す ")
    assert n.text == "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"
    assert n.hints == (4, 10, 14, 20)


def test_preprocess_segments_tanka():
    r = preprocess("夕暮れの駅のホームで寂しくて君からの文字何度も読み返す")
    assert [s.text for s in r.segments] == ["夕暮れの", "駅のホームで", "寂しくて", "君からの文字", "何度も読み返す"]
    assert [s.mora for s in r.segments] == [5, 7, 5, 7, 9]
    assert r.segments[4].reading == "なんどもよみかえす"
    assert r.style == "colloquial" and r.orthography == "modern"
    assert r.totalMora == 33
    # 番号付きの形態素が五句に対応づく
    assert all(t.segmentNo is not None for t in r.tokens)
    assert [t.index for t in r.tokens] == list(range(len(r.tokens)))


def test_preprocess_reading_candidates():
    r = preprocess("夕暮れの駅のホームで寂しくて君からの文字何度も読み返す")
    by_surface = {c.surface: c for c in r.candidates}
    assert by_surface["文字"].readings[:2] == ["もじ", "もんじ"]
    assert by_surface["文字"].selected == "もじ"


def test_preprocess_uses_reading_memory():
    r = preprocess("夕暮れの駅のホームで寂しくて君からの文字何度も読み返す", reading_memory={"文字": "もんじ"})
    assert r.segments[3].reading == "きみからのもんじ"
    assert r.segments[3].mora == 8


def test_hints_take_priority():
    # 空白のヒントどおりに分ける（定型とずれても）
    r = preprocess("白い息 ふたつ並んで信号の 青を 待つ間の わずかな会話")
    assert [s.text for s in r.segments] == ["白い息", "ふたつ並んで信号の", "青を", "待つ間の", "わずかな会話"]


def test_detects_literary_historical():
    r = preprocess("けふもまた君を思ひて言ひにけり夕べの空の色ぞ悲しき")
    assert r.detectedStyle == "literary"
    assert r.detectedOrthography == "historical"


def test_author_can_override_style():
    r = preprocess("夕暮れの駅のホームで寂しくて君からの文字何度も読み返す", style="literary", orthography="historical")
    assert r.style == "literary" and r.orthography == "historical"
    assert r.detectedStyle == "colloquial"


def test_too_short():
    with pytest.raises(PreprocessError):
        preprocess("あめ")


def test_build_from_confirmed():
    segs = [
        ConfirmedSegment(1, "夕暮れの", "ゆうぐれの"),
        ConfirmedSegment(2, "駅のホームで", "えきのほーむで"),
        ConfirmedSegment(3, "寂しくて", "さびしくて"),
        ConfirmedSegment(4, "君からの文字", "きみからのもんじ"),
        ConfirmedSegment(5, "何度も読み返す", "なんどもよみかえす"),
    ]
    b = build_from_confirmed("夕暮れの 駅のホームで 寂しくて 君からの文字 何度も読み返す", segs, style="colloquial")
    assert b.bodyNormalized == "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"
    assert [s.mora for s in b.segments] == [5, 7, 5, 8, 9]
    assert b.segments[3].span == (14, 20)
    assert b.reading.startswith("ゆうぐれの")


def test_build_from_confirmed_rejects_mismatch():
    segs = [ConfirmedSegment(i, "あ", "あ") for i in range(1, 6)]
    with pytest.raises(PreprocessError):
        build_from_confirmed("いいいいい", segs, style="colloquial")
