import { useState } from "react";
import { Navigate } from "react-router-dom";
import { sendEmailLink, signInWithGoogle, useAuth } from "../lib/auth";

export default function LoginPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<"choose" | "email" | "sent">("choose");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function google() {
    setError(null);
    try {
      await signInWithGoogle();
    } catch {
      setError("ログインできませんでした。もう一度お試しください。");
    }
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendEmailLink(email.trim());
      setMode("sent");
    } catch {
      setError("メールを送れませんでした。アドレスを確かめてください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 28px", minHeight: "100dvh" }}>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 28 }}>
        <h1 className="serif" style={{ margin: 0, fontWeight: 600, fontSize: 44, letterSpacing: "0.12em" }}>推敲帖</h1>
        <p className="serif" style={{ margin: 0, fontSize: 18, lineHeight: 1.9 }}>
          一首を、何度でも。
          <br />
          推敲のたびに、つまずきを指摘します。
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
          歌を作ったり直したりはしません。字余りや常套句など、よくあるつまずきを見つけて知らせるだけです。直すかどうかは、あなたが決めます。
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 28 }}>
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        {mode === "choose" && (
          <>
            <button type="button" className="btn-primary" onClick={google}>Googleアカウントで続ける</button>
            <button type="button" className="btn-secondary" onClick={() => setMode("email")}>メールアドレスで続ける</button>
          </>
        )}
        {mode === "email" && (
          <form onSubmit={submitEmail} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label className="label" htmlFor="email">メールアドレス</label>
            <input id="email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={busy || !email}>ログイン用のリンクを送る</button>
            <button type="button" className="btn-secondary" onClick={() => setMode("choose")}>戻る</button>
          </form>
        )}
        {mode === "sent" && (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
            {email} にログイン用のリンクを送りました。メールを開いてリンクを押してください。
          </p>
        )}
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.7, textAlign: "center" }}>
          続けると<a href="#terms">利用規約</a>と<a href="#privacy">プライバシーポリシー</a>に同意したものとみなします。
        </p>
      </div>
    </div>
  );
}
