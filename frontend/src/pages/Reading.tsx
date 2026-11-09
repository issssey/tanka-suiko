import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, preprocess, saveRevision } from "../lib/api";
import { useTanka } from "../lib/data";
import { clearDraft, loadDraft, saveDraft } from "../lib/draft";
import { segLabel } from "../lib/findings";
import { countMorae, toHiragana } from "../lib/mora";
import type { Orthography, PreprocessResponse, Style } from "../lib/types";
import { Loading, TopBar, UnreadableHelp } from "../components/ui";

const KANSUJI = ["", "一", "二", "三", "四", "五"];

export default function ReadingPage() {
  const { tankaId = "" } = useParams();
  const navigate = useNavigate();
  const { data: tanka } = useTanka(tankaId);
  const draft = useMemo(() => loadDraft(tankaId), [tankaId]);
  const [style, setStyle] = useState<Style | undefined>(draft?.style);
  const [orth, setOrth] = useState<Orthography | undefined>(draft?.orthography);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PreprocessResponse | null>(null);
  // 作者が手で直した読み（句の本文が変わらない限り残す）
  const [manual, setManual] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // 短歌として読み取れない入力（422）。チェックをしないので、理由と基準を出す
  const [unreadable, setUnreadable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    setError(null);
    setUnreadable(false);
    preprocess(tankaId, draft.body, { style, orthography: orth, readingOverrides: overrides })
      .then((r) => !cancelled && setResult(r))
      .catch((e) => {
        if (cancelled) return;
        const isUnreadable = e instanceof ApiError && e.status === 422;
        setUnreadable(isUnreadable);
        if (isUnreadable) setResult(null);
        setError(e instanceof Error ? e.message : "読みを取得できませんでした");
      });
    return () => {
      cancelled = true;
    };
  }, [tankaId, draft, style, orth, overrides]);

  if (!draft) {
    return (
      <>
        <TopBar back="/" backLabel="一覧に戻る" title="読みと句分けの確認" />
        <div className="center-msg">
          下書きが見つかりません。<Link to={`/t/${tankaId}/edit`}>本文の編集</Link>からやり直してください。
        </div>
      </>
    );
  }

  const backHref = draft.parentRevisionId ? `/t/${tankaId}/edit?from=${draft.parentRevisionId}` : "/new";
  const segKey = (no: number, text: string) => `${no}:${text}`;
  const readingOf = (no: number, text: string, fallback: string) => manual[segKey(no, text)] ?? fallback;
  const total = result ? result.segments.reduce((n, s) => n + countMorae(readingOf(s.no, s.text, s.reading)), 0) : 0;

  async function save() {
    if (!result || !draft) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveRevision(tankaId, {
        parentRevisionId: draft.parentRevisionId,
        body: draft.body,
        segments: result.segments.map((s) => ({ no: s.no, text: s.text, reading: toHiragana(readingOf(s.no, s.text, s.reading)) })),
        style: result.style,
        orthography: result.orthography,
        note: draft.note || null,
        readingChoices: overrides,
      });
      clearDraft(tankaId);
      navigate(`/t/${tankaId}/r/${res.revisionId}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
      setBusy(false);
    }
  }

  function choose(surface: string, reading: string) {
    setOverrides((o) => ({ ...o, [surface]: reading }));
  }

  function changeStyle(s: Style) {
    setStyle(s);
    saveDraft({ ...draft!, style: s, orthography: orth });
  }
  function changeOrth(o: Orthography) {
    setOrth(o);
    saveDraft({ ...draft!, style, orthography: o });
  }

  const sub = tanka ? `第${tanka.nextRevisionNo}稿` : undefined;

  return (
    <>
      <TopBar back={backHref} backLabel="本文の編集に戻る" title="読みと句分けの確認" sub={sub} />
      {!result && !error && <Loading />}
      {error && <p role="alert" className="error">{error}</p>}
      {unreadable && <UnreadableHelp style={{ margin: "20px 20px 0" }} />}
      {result && (
        <>
          <div style={{ display: "flex", gap: 8, padding: "4px 20px 12px", flexWrap: "wrap", alignItems: "center" }}>
            <div className="segmented" role="group" aria-label="文体">
              <button type="button" aria-pressed={result.style === "colloquial"} onClick={() => changeStyle("colloquial")}>口語</button>
              <button type="button" aria-pressed={result.style === "literary"} onClick={() => changeStyle("literary")}>文語</button>
            </div>
            <div className="segmented" role="group" aria-label="仮名遣い">
              <button type="button" aria-pressed={result.orthography === "modern"} onClick={() => changeOrth("modern")}>新仮名</button>
              <button type="button" aria-pressed={result.orthography === "historical"} onClick={() => changeOrth("historical")}>旧仮名</button>
            </div>
            <span className="small muted">自動判定 · 変更できます</span>
          </div>

          <ol style={{ listStyle: "none", margin: 0, padding: "0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {result.segments.map((s) => {
              const reading = readingOf(s.no, s.text, s.reading);
              const mora = countMorae(reading);
              const off = mora !== s.expected;
              const segTokens = result.tokens.filter((t) => t.segmentNo === s.no).map((t) => t.index);
              const cands = result.candidates.filter((c) => segTokens.includes(c.tokenIndex));
              const unknown = result.unknownWords.filter((u) => segTokens.includes(u.tokenIndex));
              const focus = cands.length > 0 || unknown.length > 0;
              return (
                <li key={s.no} className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderRadius: 12, border: focus ? "1.5px solid var(--accent)" : undefined }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="serif muted" style={{ fontSize: 13, width: 16 }}>{KANSUJI[s.no]}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
                      <span className="serif" style={{ fontSize: 17 }}>{s.text}</span>
                      <label style={{ display: "flex", flexDirection: "column" }}>
                        <span className="sr-only">{segLabel(s.no)}の読み</span>
                        <input
                          type="text"
                          maxLength={40}
                          value={reading}
                          onChange={(e) => setManual((m) => ({ ...m, [segKey(s.no, s.text)]: e.target.value }))}
                          style={{ border: "none", borderBottom: "1px dashed var(--neutral-line)", padding: "2px 0", background: "transparent", fontSize: 13, color: "var(--muted)", fontFamily: "var(--sans)" }}
                        />
                      </label>
                    </div>
                    <span
                      style={{ fontSize: 13, fontWeight: off ? 700 : 500, color: off ? "var(--high)" : "var(--muted)", fontVariantNumeric: "tabular-nums", padding: off ? "3px 8px" : undefined, borderRadius: 999, background: off ? "var(--high-bg)" : undefined, whiteSpace: "nowrap" }}
                    >
                      {mora} / {s.expected}
                    </span>
                  </div>
                  {cands.map((c) => (
                    <div key={c.tokenIndex} style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 28, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>「{c.surface}」の読み</span>
                      {c.readings.map((r) => (
                        <button key={r} type="button" className="pill" aria-pressed={(overrides[c.surface] ?? c.selected) === r} onClick={() => choose(c.surface, r)}>
                          {r}
                        </button>
                      ))}
                    </div>
                  ))}
                  {unknown.map((u) => (
                    <UnknownWordInput key={u.tokenIndex} surface={u.surface} initial={overrides[u.surface] ?? u.reading} onCommit={(r) => choose(u.surface, r)} />
                  ))}
                </li>
              );
            })}
          </ol>

          <p className="hint" style={{ padding: "14px 20px 0" }}>
            読みは発音どおりにモーラで数えます。点線の読みはタップして直せます。選んだ読みはこの短歌で次から優先して使います。
          </p>
        </>
      )}
      <div className="footer-bar">
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
          <span>合計</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "var(--text)", fontWeight: 700 }}>{total}</span> / 31 モーラ
          </span>
        </div>
        <button type="button" className="btn-primary" disabled={!result || busy} onClick={save}>
          この読みで保存してチェック
        </button>
      </div>
    </>
  );
}

function UnknownWordInput({ surface, initial, onCommit }: { surface: string; initial: string; onCommit: (r: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 28, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>「{surface}」の読みを入力</span>
      <input
        className="input"
        style={{ height: 36, padding: "0 10px", fontSize: 14, width: 160 }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() && value !== initial && onCommit(toHiragana(value.trim()))}
      />
    </label>
  );
}
