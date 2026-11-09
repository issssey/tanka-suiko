// 鑑賞（設計書「鑑賞」）。作者が頼んだ稿について、短歌を読み慣れた読み手がどう読むかを出す。
// 評価・改作案は出さず、指摘ではないので「意図的」「誤検出」も付けない。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, requestAppreciation, saveAppreciationNote } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAppreciation, useAppreciationsToday, useRevision } from "../lib/data";
import type { Appreciation, Revision } from "../lib/types";
import { DetailSection, LinkRow } from "./detail";
import { formatDate } from "./ui";

/** 1人1日に頼める回数（サーバーの APPRECIATION_DAILY_LIMIT の既定と同じ。超えたらサーバーも 429 で断る）。 */
export const APPRECIATION_DAILY_LIMIT = 10;

export const READER_NOTE = "AIが想定した、短歌を読み慣れた読み手の読みです。";

export function appreciationPath(tankaId: string, revisionId: string) {
  return `/t/${tankaId}/r/${revisionId}/appreciation`;
}

/** 浮かんだ場面の最初の1文（チェック結果の欄に1行で出す）。 */
export function firstSentence(text: string | null): string {
  if (!text) return "";
  const i = text.indexOf("。");
  return i >= 0 && i < text.length - 1 ? text.slice(0, i + 1) : text;
}

/** 鑑賞を頼む操作。上限に達したら「今日はもう頼めません」。 */
function useRequest(tankaId: string, revisionId: string) {
  const { user } = useAuth();
  const { data: today } = useAppreciationsToday(user?.uid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      await requestAppreciation(tankaId, revisionId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setLimited(true);
      else setError(e instanceof Error ? e.message : "頼めませんでした");
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, limited: limited || today >= APPRECIATION_DAILY_LIMIT };
}

function RequestButton({ tankaId, revisionId, label }: { tankaId: string; revisionId: string; label: string }) {
  const req = useRequest(tankaId, revisionId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button type="button" className="btn-secondary" disabled={req.busy || req.limited} onClick={req.run}>
        {req.busy ? "頼んでいます…" : label}
      </button>
      {req.limited && <p className="small muted" style={{ margin: 0 }}>今日はもう頼めません（1日{APPRECIATION_DAILY_LIMIT}回まで）。</p>}
      {req.error && <p className="error" style={{ margin: 0 }}>{req.error}</p>}
    </div>
  );
}

function Pending({ children }: { children?: ReactNode }) {
  return (
    <div className="linked-rows detail-rows">
      <div className="linked-row" role="status">
        <span className="spinner" aria-hidden="true" />
        <span className="what">
          <span className="t">鑑賞中</span>
          <span className="s">通常30秒ほどで終わります。ほかの画面に移っても結果は保存されます。</span>
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * チェック結果の「鑑賞」の欄。まだなら「この稿を鑑賞してもらう」、判定中なら「鑑賞中」、
 * 済んでいれば「浮かんだ場面」の1行と鑑賞へのリンク。
 */
export function AppreciationSection({ tankaId, rev }: { tankaId: string; rev: Revision }) {
  const { data: a, loading } = useAppreciation(tankaId, rev.id);
  if (loading) return null;
  let body: ReactNode;
  if (!a) {
    body = (
      <>
        <p className="small muted" style={{ margin: 0, lineHeight: 1.7 }}>短歌を読み慣れた読み手に、この稿がどう読めるかを返します。良し悪しは判定しません。</p>
        <RequestButton tankaId={tankaId} revisionId={rev.id} label="この稿を鑑賞してもらう" />
      </>
    );
  } else if (a.status === "pending") {
    body = <Pending />;
  } else if (a.status === "failed") {
    body = (
      <>
        <p className="error" style={{ margin: 0 }}>鑑賞できませんでした{a.error ? `（${a.error}）` : ""}</p>
        <RequestButton tankaId={tankaId} revisionId={rev.id} label="もう一度頼む" />
      </>
    );
  } else {
    body = (
      <div className="linked-rows detail-rows">
        <LinkRow title={firstSentence(a.scene)} sub={`第${rev.revisionNo}稿の鑑賞 · ${formatDate(a.createdAt)}`} to={appreciationPath(tankaId, rev.id)} />
      </div>
    );
  }
  return <DetailSection title="鑑賞">{body}</DetailSection>;
}

/** 本文に、立ち止まった箇所・読みが割れそうな箇所の点線を付ける。 */
function MarkedPoem({ text, a }: { text: string; a: Appreciation }) {
  const marked = Array.from({ length: text.length }, () => false);
  for (const p of [...a.pauses, ...a.splits]) for (let i = p.span[0]; i < Math.min(p.span[1], text.length); i++) marked[i] = true;
  const parts: { text: string; mark: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.mark === marked[i]) last.text += text[i];
    else parts.push({ text: text[i], mark: marked[i] });
  }
  const any = marked.some(Boolean);
  return (
    <section className="appr-poem">
      <p className="serif">{parts.map((p, i) => (p.mark ? <span key={i} className="appr-mark">{p.text}</span> : p.text))}</p>
      {any && <span className="small muted">点線：立ち止まった箇所・読みが割れそうな箇所</span>}
    </section>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="appr-block">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const CIRCLED = ["①", "②", "③"];

function Scene({ a }: { a: Appreciation }) {
  return (
    <Block title="浮かんだ場面">
      <div className="appr-card"><p>{a.scene}</p></div>
    </Block>
  );
}

function Feeling({ a }: { a: Appreciation }) {
  return (
    <Block title="受け取った気持ち・主題">
      <div className="appr-card"><p>{a.feeling}</p></div>
    </Block>
  );
}

function Pauses({ a }: { a: Appreciation }) {
  return (
    <Block title="立ち止まった箇所">
      {a.pauses.length === 0 ? (
        <p className="detail-empty">立ち止まった箇所はありませんでした</p>
      ) : (
        a.pauses.map((p, i) => (
          <div key={i} className="appr-card">
            <span className="appr-phrase">「{p.text}」</span>
            <p>{p.reason}</p>
          </div>
        ))
      )}
    </Block>
  );
}

function Splits({ a }: { a: Appreciation }) {
  return (
    <Block title="読みが割れそうな箇所">
      {a.splits.length === 0 ? (
        <p className="detail-empty">読みが割れそうな箇所はありませんでした</p>
      ) : (
        a.splits.map((s, i) => (
          <div key={i} className="appr-card">
            <span className="appr-phrase">「{s.text}」</span>
            <ul className="appr-readings">
              {s.readings.map((r, j) => (
                <li key={j}><span className="muted">{CIRCLED[j] ?? `${j + 1}.`}</span><span>{r}</span></li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Block>
  );
}

/** 前の稿と比べる（前の稿に鑑賞があるときだけ）。浮かんだ場面を並べる。 */
function Compare({ tankaId, rev, a }: { tankaId: string; rev: Revision; a: Appreciation }) {
  const { data: parent } = useRevision(tankaId, rev.parentRevisionId);
  const { data: before } = useAppreciation(tankaId, rev.parentRevisionId);
  if (!parent || !before || before.status !== "done") return null;
  return (
    <Block title="前の稿と比べる">
      <p className="small muted" style={{ margin: 0 }}>浮かんだ場面</p>
      <div className="appr-compare">
        <div>
          <span className="small muted">第{parent.revisionNo}稿 · {parent.bodyNormalized}</span>
          <span>{before.scene}</span>
        </div>
        <div>
          <span className="small muted">第{rev.revisionNo}稿（この稿）</span>
          <span>{a.scene}</span>
        </div>
      </div>
      <Link to={appreciationPath(tankaId, parent.id)} style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
        第{parent.revisionNo}稿の鑑賞を見る
      </Link>
    </Block>
  );
}

/** 伝えたかったこと。読みを見た後に書く欄。AIは読みと合っているか判定せず、並べて見せるだけ。欄を離れるか、手を止めると保存する。 */
function AuthorNote({ tankaId, revisionId, initial }: { tankaId: string; revisionId: string; initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saved = useRef(initial ?? "");
  const timer = useRef<number | null>(null);

  async function save(v: string) {
    if (timer.current) window.clearTimeout(timer.current);
    if (v.trim() === saved.current.trim()) return;
    setState("saving");
    try {
      await saveAppreciationNote(tankaId, revisionId, v);
      saved.current = v;
      setState("saved");
    } catch {
      setState("error");
    }
  }
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return (
    <Block title="伝えたかったこと">
      <label htmlFor="appr-note" className="sr-only">伝えたかったこと</label>
      <textarea
        id="appr-note"
        className="appr-note"
        rows={3}
        maxLength={500}
        value={value}
        placeholder="読みを見て、伝えたかったことを書いておけます（任意）"
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => save(v), 1200);
        }}
        onBlur={() => save(value)}
      />
      {state !== "idle" && (
        <span role="status" aria-live="polite" className="small muted">
          {state === "saving" ? "保存中…" : state === "saved" ? "保存しました" : "保存できませんでした"}
        </span>
      )}
    </Block>
  );
}

/** 鑑賞の中身。本文 → 浮かんだ場面 → 気持ち・主題 → 立ち止まった箇所 → 読みが割れそうな箇所 → 前の稿との比較 → 伝えたかったこと。 */
export function AppreciationBody({ tankaId, rev, a, pc }: { tankaId: string; rev: Revision; a: Appreciation; pc?: boolean }) {
  const reading = pc ? (
    <div className="appr-grid">
      <div className="appr-col"><Scene a={a} /><Feeling a={a} /><Pauses a={a} /></div>
      <div className="appr-col"><Splits a={a} /></div>
    </div>
  ) : (
    <>
      <Scene a={a} />
      <Feeling a={a} />
      <Pauses a={a} />
      <Splits a={a} />
    </>
  );
  return (
    <div className={pc ? "appr appr-wide" : "appr"}>
      <MarkedPoem text={rev.bodyNormalized} a={a} />
      <p className="small muted" style={{ margin: 0, lineHeight: 1.6 }}>{READER_NOTE}</p>
      {reading}
      <Compare tankaId={tankaId} rev={rev} a={a} />
      <AuthorNote key={rev.id} tankaId={tankaId} revisionId={rev.id} initial={a.authorNote} />
    </div>
  );
}

/** 鑑賞がまだ済んでいないとき（判定中・失敗・まだ頼んでいない）。 */
export function AppreciationNotReady({ tankaId, rev, a }: { tankaId: string; rev: Revision; a: Appreciation | null }) {
  return (
    <div className="appr">
      {a?.status === "pending" ? (
        <Pending />
      ) : a?.status === "failed" ? (
        <>
          <p className="error" style={{ margin: 0 }}>鑑賞できませんでした{a.error ? `（${a.error}）` : ""}</p>
          <RequestButton tankaId={tankaId} revisionId={rev.id} label="もう一度頼む" />
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, lineHeight: 1.8 }}>この稿はまだ鑑賞していません。</p>
          <RequestButton tankaId={tankaId} revisionId={rev.id} label="この稿を鑑賞してもらう" />
        </>
      )}
    </div>
  );
}
