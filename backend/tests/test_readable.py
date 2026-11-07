import pytest

from app.preprocess.pipeline import ConfirmedSegment, UnreadableError, build_from_confirmed, preprocess


@pytest.mark.parametrize(
    "body",
    [
        "あ" * 31,  # 同じ文字の連続
        "あいあいあいあいあいあいあいあいあいあいあいあいあいあいあい",  # 文字の種類が少なすぎる
        "asdfghjkl qwertyuiop zxcvbnm asdf qwer",  # かな・漢字がほとんどない
        "うんうん、はいはい、ねえ、ああ、ええ、おお",  # 意味を持つ語がない（感動詞だけ）
    ],
)
def test_unreadable_inputs_are_rejected(body):
    with pytest.raises(UnreadableError):
        preprocess(body)


@pytest.mark.parametrize(
    "body",
    [
        "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す",
        "けふもまた君を思ひて言ひにけり夕べの空の色ぞ悲しき",
        "ぽつぽつと雨ぽつぽつと傘ぽつと君のぽつりとこぼす言の葉",  # オノマトペの多い歌
        "ああ夏よ ああ海よ光る 波の音 ああ君がいて ああ僕がいる",  # 感動詞が多くても語があれば通す
        "ＡＩと話す夜更けのキッチンでコーヒー二杯ぶんの沈黙",  # 英字が少し混じる
    ],
)
def test_real_tanka_pass(body):
    preprocess(body)


def test_save_is_rejected_too():
    """API を直接呼んで保存しようとしても断る（LLM を呼ばない）。"""
    body = "あ" * 31
    segs = [ConfirmedSegment(i, t, t) for i, t in enumerate(["あああああ", "あああああああ", "あああああ", "あああああああ", "あああああああ"], 1)]
    with pytest.raises(UnreadableError):
        build_from_confirmed(body, segs, style="colloquial")
