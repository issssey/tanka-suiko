// 気づき（設計書「気づき」）。歌になる前の素材。AIは使わず、作者が見ながら歌を書き始める。
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deleteNote, updateNote } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useNote, useTankas } from "../lib/data";
import type { Note, Tanka } from "../lib/types";
import { DangerFooter, DetailSection, InfoRows, LinkRow, LinkRows } from "./detail";
import { ConfirmDialog, formatDate } from "./ui";

export const NOTE_MAX = 500;

/** この気づきから書いた歌（稿を保存したものだけ）。 */
export function songsOf(note: Note, tankasById: Map<string, Tanka>): Tanka[] {
  return note.tankaIds.map((id) => tankasById.get(id)).filter((t): t is Tanka => Boolean(t?.currentRevisionId));
}

export function useTankasById() {
  const { user } = useAuth();
  const { data: tankas } = useTankas(user?.uid);
  return useMemo(() => new Map(tankas.map((t) => [t.id, t])), [tankas]);
}

/** 本文で探す（空なら全部）。 */
export function filterNotes(notes: Note[], q: string): Note[] {
  const needle = q.trim();
  return needle ? notes.filter((n) => n.body.includes(needle)) : notes;
}

/** 一覧のカード。本文が主役で、日時と「歌にした N首」。 */
export function NoteCard({ note, songs, to, current, compact }: { note: Note; songs: number; to: string; current?: boolean; compact?: boolean }) {
  return (
    <Link to={to} className={compact ? undefined : "card tanka-card note-card"} aria-current={current ? "page" : undefined}>
      <p className={compact ? "note-line" : "note-body-clamp"}>{note.body}</p>
      <span className={compact ? "small muted" : "card-meta"}>{formatDate(note.createdAt)}</span>
      {songs > 0 && (
        <span className="chips">
          <span className="chip outline">歌にした {songs}首</span>
        </span>
      )}
    </Link>
  );
}

/** 気づきのつながり：この気づきから書いた歌。 */
export function NoteRelations({ note, tankasById }: { note: Note; tankasById: Map<string, Tanka> }) {
  const songs = songsOf(note, tankasById);
  return (
    <DetailSection title="つながり">
      <LinkRows empty="この気づきから書いた歌はまだありません">
        {songs.map((t) => (
          <LinkRow key={t.id} chip="短歌" title={<span className="serif">{t.latestBody}</span>} sub={`第${t.latestRevisionNo}稿 · ${formatDate(t.updatedAt)}`} to={`/t/${t.id}/r/${t.currentRevisionId}`} />
        ))}
      </LinkRows>
    </DetailSection>
  );
}

/** 気づきの履歴：書いた日・直した日。 */
export function NoteHistory({ note }: { note: Note }) {
  const rows: [string, string][] = [["書いた日", formatDate(note.createdAt)]];
  if (note.updatedAt.getTime() - note.createdAt.getTime() > 1000) rows.push(["直した日", formatDate(note.updatedAt)]);
  return (
    <DetailSection title="履歴">
      <InfoRows rows={rows} />
    </DetailSection>
  );
}

/** 気づきの削除（確認つき）。消してもそこから書いた歌は残る。 */
export function NoteDeleteButton({ note, songs, after }: { note: Note; songs: number; after: string }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true);
    try {
      await deleteNote(note.id);
      navigate(after, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除できませんでした");
      setBusy(false);
      setConfirm(false);
    }
  }
  return (
    <>
      {error && <p className="error">{error}</p>}
      <DangerFooter label="この気づきを削除" onClick={() => setConfirm(true)} />
      {confirm && (
        <ConfirmDialog title="この気づきを削除しますか？" confirmLabel="気づきを削除する" busy={busy} onConfirm={remove} onCancel={() => setConfirm(false)}>
          <p className="quote plain" style={{ whiteSpace: "pre-wrap" }}>{note.body}</p>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
            この気づきが削除されます。<strong>削除すると元に戻せません。</strong>
          </p>
          <p className="small muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            {songs > 0 ? `この気づきから書いた歌（${songs}首）は消えません。` : "短歌・連作・発表記録は消えません。"}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** その場で直す本文（PC版の詳細）。手を止めるか欄を離れると保存する。 */
export function NoteInlineEditor({ note }: { note: Note }) {
  const [value, setValue] = useState(note.body);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saved = useRef(note.body);
  const timer = useRef<number | null>(null);

  // 別の端末で直されたら反映する（入力中でなければ）
  useEffect(() => {
    if (value === saved.current) setValue(note.body);
    saved.current = note.body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.body]);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  async function save(v: string) {
    if (timer.current) window.clearTimeout(timer.current);
    if (!v.trim() || v.trim() === saved.current.trim()) return;
    setState("saving");
    try {
      await updateNote(note.id, v);
      saved.current = v.trim();
      setState("saved");
    } catch {
      setState("error");
    }
  }
  const status = state === "saving" ? "保存中…" : state === "saved" ? "自動で保存しました" : state === "error" ? "保存できませんでした" : "直すと自動で保存します";
  return (
    <section className="card pub-edit">
      <label htmlFor="note-inline" className="sr-only">気づき</label>
      <textarea
        id="note-inline"
        className="form-textarea note-textarea"
        rows={5}
        maxLength={NOTE_MAX}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => save(v), 1200);
        }}
        onBlur={() => save(value)}
      />
      <span role="status" aria-live="polite" className="save-status" data-state={state === "error" ? "error" : state === "idle" ? "saved" : state}>
        {state === "saving" && <span className="spinner" aria-hidden="true" style={{ width: 12, height: 12 }} />}
        {status}
      </span>
    </section>
  );
}

/**
 * 歌を書く画面の上に出す「もとにした気づき」。入力欄には入れず、写したいときだけ「本文に写す」。
 * 気づきは参考で、AIが歌にすることはない。
 */
export function NoteSource({ noteId, onCopy }: { noteId: string; onCopy?: (body: string) => void }) {
  const { data: note } = useNote(noteId);
  if (!note) return null;
  return (
    <section className="note-source">
      <span className="small muted" style={{ fontWeight: 500 }}>もとにした気づき</span>
      <p>{note.body}</p>
      {onCopy && (
        <button type="button" className="text-btn" style={{ alignSelf: "flex-start" }} onClick={() => onCopy(note.body)}>
          本文に写す
        </button>
      )}
    </section>
  );
}

/** 短歌のつながりに出す「もとにした気づき」。 */
export function SourceNoteRow({ noteId }: { noteId: string }) {
  const { data: note } = useNote(noteId);
  if (!note) return null;
  const first = note.body.split("\n")[0];
  return <LinkRow chip="気づき" title={first.length > 40 ? `${first.slice(0, 40)}…` : first} sub={`${formatDate(note.createdAt)}に書いた気づき`} to={`/notes/${note.id}`} />;
}
