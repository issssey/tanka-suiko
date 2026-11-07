import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true });

const EMAIL_KEY = "suiko.emailForSignIn";
// 開発時の StrictMode で effect が2回走っても、同じリンクで2回サインインしない
let emailLinkHandled = false;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    // メールのリンクから戻ってきた場合はサインインを完了させる
    if (!emailLinkHandled && isSignInWithEmailLink(auth, window.location.href)) {
      emailLinkHandled = true;
      const email = safeGet(EMAIL_KEY) ?? window.prompt("確認のため、メールアドレスを入力してください") ?? "";
      if (email) {
        signInWithEmailLink(auth, email, window.location.href)
          .then(() => {
            safeRemove(EMAIL_KEY);
            window.history.replaceState(null, "", "/");
          })
          .catch(() => undefined);
      }
    }
    return onAuthStateChanged(auth, (user) => setState({ user, loading: false }));
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export async function sendEmailLink(email: string) {
  await sendSignInLinkToEmail(auth, email, { url: `${window.location.origin}/`, handleCodeInApp: true });
  safeSet(EMAIL_KEY, email);
}

export function logout() {
  return signOut(auth);
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 保存できなくても続ける */
  }
}
function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
