// PC版の「新しい短歌」「推敲を書く」。入力に合わせて、右側に読みと句分けを同時に出す。
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createTanka } from "../../lib/api";
import { useRevision, useTanka } from "../../lib/data";
import { segLabel } from "../../lib/findings";
import { countMorae, toHiragana } from "../../lib/mora";
import { loadSettings } from "../../lib/settings";
import { saveWithReadings, usePreprocess } from "../../lib/usePreprocess";
import { PcShell } from "../../components/pc";
import { UnreadableHelp } from "../../components/ui";
import { NoteSource } from "../../components/notes";

const KANSUJI = ["", "一", "二", "三", "四", "五"];

export default function PcWrite() {
  const { tankaId: routeTankaId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !routeTankaId;
  // 気づきから書くときは ?note= で受け取り、上に出す（入力欄には入れない）
  const noteId = isNew ? params.get("note") : null;
  const [tankaId, setTankaId] = useState<string | null>(routeTankaId ?? null);
  const { data: tanka } = useTanka(tankaId ?? undefined);
  const parentId = isNew ? null : (params.get("from") ?? tanka?.currentRevisionId ?? null);
  const { data: parent } = useRevision(tankaId ?? undefined, parentId);
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const filled = useRef(false);
  const creating = useRef(false);

  // 推敲では、前の稿の句を空白で区切って本文の初期値にする
  useEffect(() => {
    if (!filled.current && parent) {
      filled.current = true;
      setBody(parent.segments.map((s) => s.text).join(" "));
    }
  }, [parent]);

  // 新しい短歌は、本文を書き始めたときに短歌を作る（読みの取得に短歌のIDが要る）
  useEffect(() => {
    if (isNew && !tankaId && body.trim() && !creating.current) {
      creating.current = true;
      createTanka()
        .then(({ tankaId: id }) => setTankaId(id))
        .catch((e) => setSaveError(e instanceof Error ? e.message : "保存できませんでした"))
        .finally(() => (creating.current = false));
    }
  }, [isNew, tankaId, body]);

  const s = loadSettings();
  const reading = usePreprocess(
    tankaId,
    body,
    isNew
      ? {
          style: s.defaultStyle === "auto" ? undefined : s.defaultStyle,
          orthography: s.defaultOrthography === "auto" ? undefined : s.defaultOrthography,
        }
      : { style: parent?.style, orthography: parent?.orthography },
    400,
  );
  const r = reading.result;

  // 推敲では前の稿の文体・仮名遣いを引き継ぐ（前の稿は後から読み込まれる）
  const { style: curStyle, setStyle, setOrthography } = reading;
  useEffect(() => {
    if (parent && curStyle === undefined) {
      setStyle(parent.style);
      setOrthography(parent.orthography);
    }
  }, [parent, curStyle, setStyle, setOrthography]);

  async function save() {
    if (!tankaId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await saveWithReadings(tankaId, reading, { parentRevisionId: isNew ? null : parent?.id ?? null, body, note, sourceNoteId: noteId });
      navigate(`/t/${tankaId}/r/${res.revisionId}`, { replace: true });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存できませんでした");
      setSaving(false);
    }
  }

  const nextNo = tanka?.nextRevisionNo ?? 1;
  const aside = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h2>読みと句分け</h2>
        {r && (
          <div style={{ display: "flex", gap: 6 }}>
            <div className="segmented" role="group" aria-label="文体">
              <button type="button" aria-pressed={r.style === "colloquial"} onClick={() => reading.setStyle("colloquial")}>口語</button>
              <button type="button" aria-pressed={r.style === "literary"} onClick={() => reading.setStyle("literary")}>文語</button>
            </div>
            <div className="segmented" role="group" aria-label="仮名遣い">
              <button type="button" aria-pressed={r.orthography === "modern"} onClick={() => reading.setOrthography("modern")}>新仮名</button>
              <button type="button" aria-pressed={r.orthography === "historical"} onClick={() => reading.setOrthography("historical")}>旧仮名</button>
            </div>
          </div>
        )}
      </div>
      {!r && !reading.error && (
        <p className="muted" style={{ margin: "24px 0", fontSize: 14, lineHeight: 1.8, textAlign: "center" }}>
          {reading.loading ? "読みを確かめています…" : <>本文を書くと、ここに<br />五句それぞれの読みとモーラ数が出ます</>}
        </p>
      )}
      {reading.error && <p role="alert" className="error" style={{ margin: 0 }}>{reading.error}</p>}
      {reading.unreadable && <UnreadableHelp />}
      {r && (
        <>
          <ol className="pc-reading" aria-busy={reading.loading}>
            {r.segments.map((seg) => {
              const value = reading.readingOf(seg.no, seg.text, seg.reading);
              const mora = countMorae(value);
              const segTokens = r.tokens.filter((t) => t.segmentNo === seg.no).map((t) => t.index);
              const cands = r.candidates.filter((c) => segTokens.includes(c.tokenIndex));
              const unknown = r.unknownWords.filter((u) => segTokens.includes(u.tokenIndex));
              return (
                <li key={seg.no}>
                  <div className="row">
                    <span className="serif muted" style={{ fontSize: 13, width: 14 }}>{KANSUJI[seg.no]}</span>
                    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                      <span className="serif" style={{ fontSize: 16 }}>{seg.text}</span>
                      <label>
                        <span className="sr-only">{segLabel(seg.no)}の読み</span>
                        <input maxLength={40} value={value} onChange={(e) => reading.setManualReading(seg.no, seg.text, e.target.value)} />
                      </label>
                    </div>
                    <span className={`mora-badge${mora !== seg.expected ? " off" : ""}`}>{mora} / {seg.expected}</span>
                  </div>
                  {cands.map((c) => (
                    <div key={c.tokenIndex} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 26, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>「{c.surface}」</span>
                      {c.readings.map((rd) => (
                        <button key={rd} type="button" className="pill" style={{ height: 28, fontSize: 12 }} aria-pressed={(reading.overrides[c.surface] ?? c.selected) === rd} onClick={() => reading.choose(c.surface, rd)}>
                          {rd}
                        </button>
                      ))}
                    </div>
                  ))}
                  {unknown.map((u) => (
                    <label key={u.tokenIndex} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 26 }}>
                      <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>「{u.surface}」の読み</span>
                      <input
                        className="input"
                        style={{ height: 30, padding: "0 8px", fontSize: 13, width: 140 }}
                        defaultValue={reading.overrides[u.surface] ?? u.reading}
                        onBlur={(e) => e.target.value.trim() && reading.choose(u.surface, toHiragana(e.target.value.trim()))}
                      />
                    </label>
                  ))}
                </li>
              );
            })}
          </ol>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
            <span>合計</span>
            <span><span style={{ color: "var(--text)", fontWeight: 700 }}>{reading.totalMora}</span> / 31 モーラ</span>
          </div>
          <p className="hint">読みをクリックすると直せます。選んだ読みはこの短歌で次から優先して使います。</p>
        </>
      )}
      {saveError && <p className="error" style={{ margin: 0 }}>{saveError}</p>}
      <button type="button" className="btn-primary" style={{ marginTop: "auto", height: 48, fontSize: 15 }} disabled={!r || reading.loading || saving} onClick={save}>
        {isNew ? "保存してチェック" : "この読みで保存してチェック"}
      </button>
    </>
  );

  return (
    <PcShell activeTankaId={tankaId ?? undefined} aside={aside} asideLabel="読みと句分け">
      <div className="pc-write" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{isNew ? "新しい短歌" : `第${nextNo}稿を書く`}</h1>
          <span className="small muted" style={{ fontSize: 13 }}>{isNew ? "初稿を書く" : parent ? `第${parent.revisionNo}稿から推敲` : ""}</span>
        </div>
        {noteId && <NoteSource noteId={noteId} onCopy={(t) => setBody(t.replace(/\s*\n\s*/g, " ").slice(0, 80))} />}
        {parent && (
          <section style={{ display: "flex", flexDirection: "column", gap: 6, padding: "14px 18px", background: "var(--low-bg)", borderRadius: 12 }}>
            <span className="small muted" style={{ fontWeight: 500 }}>前の稿（第{parent.revisionNo}稿）</span>
            <p className="serif" style={{ margin: 0, fontSize: 16, lineHeight: 1.9, color: "var(--text-2)" }}>{parent.bodyNormalized}</p>
          </section>
        )}
        <div className="field" style={{ padding: 0 }}>
          <label htmlFor="pc-body" style={{ fontSize: 14, color: "var(--text)" }}>本文</label>
          <textarea id="pc-body" maxLength={80} className="textarea serif" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="ここに一首を書く" />
          <p className="hint">
            {isNew
              ? "スペースや改行で句の区切りを示せます（なくても自動で分けます）。文語・旧仮名の歌も書けます。"
              : "入力に合わせて、右側の読みと句分けが更新されます"}
          </p>
        </div>
        {!isNew && (
          <div className="field" style={{ padding: 0 }}>
            <label htmlFor="pc-note" style={{ fontSize: 14, color: "var(--text)" }}>推敲メモ <span style={{ fontWeight: 400, color: "var(--muted)" }}>（任意）</span></label>
            <input id="pc-note" maxLength={200} className="input" style={{ height: 44, fontSize: 15 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：涙の描写をやめて、行動で見せる" />
          </div>
        )}
      </div>
    </PcShell>
  );
}
