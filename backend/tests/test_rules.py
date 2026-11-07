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


def test_a1_excess_is_medium_shortage_is_high(patterns):
    rev = make_revision(EKI)
    f = finalize(MoraRule().check(ctx_for(rev, patterns)), patterns)
    assert len(f) == 1
    assert f[0].code == "A1" and f[0].segmentNo == 5
    assert f[0].severity == "medium"  # 字余りは medium（設計書どおり）
    assert f[0].fingerprint == "A1:5"
    assert "9モーラ" in f[0].message and "定型は7" in f[0].message

    short = make_revision(EKI, readings={1: "ゆうべの"})
    f2 = finalize(MoraRule().check(ctx_for(short, patterns)), patterns)
    sev = {x.segmentNo: x.severity for x in f2}
    assert sev[1] == "high"  # 字足らずは high


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
    assert {f.fingerprint: f.transition for f in cur}["A1:5"] == "new"

    # 親がないときは解消なし
    assert apply_transitions(cur, None) == []
