from app.checkers.base import CheckContext, finalize
from app.checkers.rules import (
    FirstPersonRule,
    KanaMixRule,
    KumatagariRule,
    MoraRule,
    ParticleRule,
    RevertRule,
    SymbolRule,
)
from app.checkers.runner import apply_transitions, run_sync

from .helpers import make_revision

EKI = "夕暮れの駅のホームで寂しくて君からの文字何度も読み返す"


def ctx_for(rev, patterns, **kw):
    return CheckContext(revision=rev, patterns=patterns, **kw)


def test_excess_in_third_or_last_is_a5_medium(patterns):
    rev = make_revision(EKI)
    f = finalize(MoraRule().check(ctx_for(rev, patterns)), patterns)
    assert len(f) == 1
    assert f[0].code == "A5" and f[0].segmentNo == 5
    assert f[0].severity == "medium"
    assert f[0].fingerprint == "A5:5"
    assert "9モーラ" in f[0].message and "定型は7" in f[0].message
    # 「なんどもよみかえす」：途中に撥音「ん」と母音の連続「かえ」→ 定型に近く聞こえることがある
    assert f[0].evidence["extraMora"] == 2
    assert f[0].evidence["sounds"] == ["moraicNasal", "vowelSequence"]
    assert "読むと定型に近く聞こえることがあります" in f[0].message


def test_excess_in_first_second_fourth_is_a6_low(patterns):
    rev = make_revision(EKI, readings={1: "ゆうぐれのえき"})
    f = {x.code: x for x in finalize(MoraRule().check(ctx_for(rev, patterns)), patterns)}
    assert f["A6"].segmentNo == 1 and f["A6"].severity == "low" and f["A6"].fingerprint == "A6:1"
    assert "現代短歌でもよく見られます" in f["A6"].message


def test_shortage_is_a1_high(patterns):
    short = make_revision(EKI, readings={1: "ゆうべの"})
    f = {x.segmentNo: x for x in finalize(MoraRule().check(ctx_for(short, patterns)), patterns)}
    assert f[1].code == "A1" and f[1].severity == "high"  # 字足らずは high
    assert f[1].evidence["kind"] == "字足らず"


def test_extra_sounds():
    from app.checkers.rules import extra_sounds

    assert extra_sounds("とうきょうえき") == ["longVowel", "vowelSequence"]  # 「とう」は長音、「うえ」は母音の連続
    assert extra_sounds("かーてん") == ["longVowel"]  # 末尾の「ん」は句の途中ではない
    assert extra_sounds("さくらさく") == []


def test_a4_kumatagari(patterns):
    # 「文字」を四句目と五句目に分ける
    rev = make_revision(EKI, texts=["夕暮れの", "駅のホームで", "寂しくて", "君からの文", "字何度も読み返す"])
    f = finalize(KumatagariRule().check(ctx_for(rev, patterns)), patterns)
    assert any(x.evidence.get("kind") == "句またがり" and x.segmentNo == 4 for x in f)
    assert any("文／字" in x.message for x in f)


def test_a4_kuware(patterns):
    body = "白い息ふたつ並ぶ。君の信号の青を待つ間のわずかな会話"
    rev = make_revision(body, texts=["白い息", "ふたつ並ぶ。君の", "信号の", "青を待つ間の", "わずかな会話"])
    found = KumatagariRule().check(ctx_for(rev, patterns))
    kuware = [x for x in found if x.evidence.get("kind") == "句割れ"]
    assert len(kuware) == 1 and kuware[0].segmentNo == 2
    assert "ふたつ並ぶ。／君の" in kuware[0].message

    # 句末の終止形は句割れではない
    plain = make_revision("春が来た花が咲いたと君が言う窓の向こうに光あふれて")
    assert not [x for x in KumatagariRule().check(ctx_for(plain, patterns)) if x.evidence.get("kind") == "句割れ"]


def test_b7_symbols(patterns):
    rev = make_revision("夕暮れの駅のホームで寂しくて！君からの文字何度も読み返す？")
    f = finalize(SymbolRule().check(ctx_for(rev, patterns)), patterns)
    assert {x.segmentNo for x in f} == {3, 5}
    assert all(x.code == "B7" for x in f)

    one = make_revision("夕暮れの駅のホームで寂しくて！君からの文字何度も読み返す")
    assert SymbolRule().check(ctx_for(one, patterns)) == []


def test_c2_kana_mix(patterns):
    rev = make_revision("君を思ひ夜の窓辺に立ちつくし言うべき言葉ひとつ探して")
    f = finalize(KanaMixRule().check(ctx_for(rev, patterns)), patterns)
    assert len(f) == 1 and f[0].code == "C2" and f[0].severity == "high"
    assert "思ひ" in f[0].message and "言う" in f[0].message

    pure_old = make_revision("けふもまた君を思ひて言ひにけり夕べの空の色ぞ悲しき")
    assert KanaMixRule().check(ctx_for(pure_old, patterns)) == []


def test_c3_no_chain(patterns):
    rev = make_revision("夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて")
    f = finalize(ParticleRule().check(ctx_for(rev, patterns)), patterns)
    assert len(f) == 1
    assert f[0].matchedText == "夕暮れの駅のホームの"
    assert f[0].fingerprint == "C3:1"


def test_c3_same_particle(patterns):
    rev = make_revision("窓に雨部屋に灯りを机には古い手紙を置いたままにして")
    found = ParticleRule().check(ctx_for(rev, patterns))
    assert any(x.evidence.get("particle") == "に" for x in found)


def test_c3_same_ending_sound(patterns):
    body = "あさがきてひるがきてまたよるがきてゆめのなかにてきみをまつかな"
    rev = make_revision(body, texts=["あさがきて", "ひるがきてまた", "よるがきて", "ゆめのなかにて", "きみをまつかな"])
    found = [x for x in ParticleRule().check(ctx_for(rev, patterns)) if x.evidence.get("kind") == "句末の音"]
    assert len(found) == 1 and found[0].evidence["sound"] == "て" and found[0].evidence["segments"] == [1, 3, 4]


def test_c5_cognition_verb(patterns):
    rev = make_revision("夕暮れの駅のホームで空を見る君からの文字何度も読み返す")
    f = finalize(FirstPersonRule().check(ctx_for(rev, patterns)), patterns)
    assert [x.fingerprint for x in f] == ["C5:見る"]
    assert "認識" in f[0].message


def test_legacy_a1_excess_is_compared_as_a5_a6(patterns):
    """切り替え前の版の A1（字余り）は、A5・A6 として比べる（解消と新規が同時に出ない）。"""
    from app.models import Finding

    legacy = Finding(code="A1", severity="medium", segmentNo=5, span=(20, 27), message="m",
                     evidence={"kind": "字余り", "mora": 9, "expected": 7}, fingerprint="A1:5")
    cur, resolved = run_sync(ctx_for(make_revision(EKI), patterns), [legacy])
    assert {f.fingerprint: f.transition for f in cur}["A5:5"] == "continued"
    assert resolved == []
    # 字足らずの A1 はそのまま A1
    short = Finding(code="A1", severity="high", segmentNo=1, message="m", evidence={"kind": "字足らず"}, fingerprint="A1:1")
    _, resolved2 = run_sync(ctx_for(make_revision(EKI), patterns), [short])
    assert resolved2 == ["A1:1"]


def test_c5_first_person(patterns):
    rev = make_revision("私だけ駅のホームで立ち止まる君からの文字何度も読み返す")
    f = finalize(FirstPersonRule().check(ctx_for(rev, patterns)), patterns)
    assert len(f) == 1 and f[0].fingerprint == "C5:私"


def test_e3_revert(patterns):
    r1 = make_revision("夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて", rev_id="r1", no=1)
    r2 = make_revision("夕暮れの駅のホームの片隅で頬を伝う涙ひとり寂しく", rev_id="r2", no=2, parent="r1")
    r3 = make_revision("夕暮れの駅のホームの片隅で君を待つ間にひとり寂しく", rev_id="r3", no=3, parent="r2")
    f = RevertRule().check(ctx_for(r3, patterns, parent=r2, history=[r1, r2]))
    assert len(f) == 1 and f[0].code == "E3"
    assert "第1稿" in f[0].message
    # 初稿・2稿目では判定しない
    assert RevertRule().check(ctx_for(r2, patterns, parent=r1, history=[r1])) == []


def test_e3_ignores_abandoned_branch(patterns):
    """枝分かれで通らなかった稿は、戻った先として数えない（比べるのは祖先だけ）。"""
    r1 = make_revision("夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて", rev_id="r1", no=1)
    r2 = make_revision("夕暮れの駅のホームの片隅で頬を伝う涙ひとり寂しく", rev_id="r2", no=2, parent="r1")
    # 第1稿から枝分かれ（第2稿は捨てた系統）
    r3 = make_revision("夕暮れの駅のホームの片隅で君を待つ間に雨が降りだす", rev_id="r3", no=3, parent="r1")
    r4 = make_revision("夕暮れの駅のホームの片隅で君を待つ間にひとり寂しく", rev_id="r4", no=4, parent="r3")
    assert RevertRule().check(ctx_for(r4, patterns, parent=r3, history=[r1, r2, r3])) == []
    # 祖先（第1稿）の表現に戻ったときは指摘する
    r5 = make_revision("夕暮れの駅のホームの片隅で君を待つ間に涙こぼれて", rev_id="r5", no=5, parent="r4")
    f = RevertRule().check(ctx_for(r5, patterns, parent=r4, history=[r1, r2, r3, r4]))
    assert len(f) == 1 and "第1稿" in f[0].message


def test_word_fingerprint_counts_occurrences(patterns):
    rev = make_revision("私だけ私の駅で立ち止まる君からの文字何度も読み返す")
    f = finalize(FirstPersonRule().check(ctx_for(rev, patterns)), patterns)
    assert [x.fingerprint for x in f] == ["C5:私", "C5:私#2"]


def test_transitions(patterns):
    r2 = make_revision("夕暮れの駅のホームの片隅で頬を伝う涙ひとり寂しく", rev_id="r2", no=2)
    r3 = make_revision(EKI, rev_id="r3", no=3, parent="r2")
    prev, _ = run_sync(ctx_for(r2, patterns), None)
    cur, resolved = run_sync(ctx_for(r3, patterns, parent=r2), prev)
    assert "C3:1" in resolved  # 「の」の連続は解消
    assert {f.fingerprint: f.transition for f in cur}["A5:5"] == "new"

    # 親がないときは解消なし
    assert apply_transitions(cur, None) == []
