import { useState } from "react";
import { Navigate } from "react-router-dom";
import { signInWithGoogle, useAuth } from "../lib/auth";

export default function LoginPage({ pc }: { pc?: boolean }) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function google() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      // ポップアップを閉じただけのときは何も出さない
      const code = (e as { code?: string }).code;
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setError("ログインできませんでした。もう一度お試しください。");
      }
    } finally {
      setBusy(false);
    }
  }

  const lead = "歌を作ったり直したりはしません。字余りや常套句など、よくあるつまずきを見つけて知らせるだけです。直すかどうかは、あなたが決めます。";
  const terms = (
    <p className="muted" style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.7, textAlign: pc ? undefined : "center" }}>
      続けると<a href="#terms">利用規約</a>と<a href="#privacy">プライバシーポリシー</a>に同意したものとみなします。
    </p>
  );
  const button = <button type="button" className="btn-primary" disabled={busy} onClick={google}>Googleアカウントで続ける</button>;

  // PC版：左に題字と説明、右にログインのカード
  if (pc) {
    return (
      <div className="pc-login">
        <section className="pc-login-hero">
          <h1 className="serif" style={{ margin: 0, fontWeight: 600, fontSize: 64, letterSpacing: "0.14em" }}>推敲帖</h1>
          <p className="serif" style={{ margin: 0, fontSize: 24, lineHeight: 1.9 }}>
            一首を、何度でも。
            <br />
            推敲のたびに、つまずきを指摘します。
          </p>
          <p className="muted" style={{ margin: 0, maxWidth: 520, fontSize: 15, lineHeight: 1.9 }}>{lead}</p>
        </section>
        <section className="pc-login-side">
          <div className="pc-login-card">
            <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>はじめる</h2>
            {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
            {button}
            {terms}
          </div>
        </section>
      </div>
    );
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
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>{lead}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 28 }}>
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        {button}
        {terms}
      </div>
    </div>
  );
}
