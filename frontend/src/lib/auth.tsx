// ログインは Google アカウントだけ（メールアドレスなどの個人情報をこちらで集めない）
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from "firebase/auth";
import { auth } from "./firebase";
import { clearSnapshotCache } from "./data";

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, loading: false })), []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** ホーム画面から全画面（standalone）で開いているか。 */
export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/**
 * Googleでログインする。ホーム画面から開いたときはポップアップが別の窓になって戻れないので、
 * 同じ画面のまま移る（redirect）。authDomain をアプリと同じドメインにしておくと、戻ったあともログインが続く。
 */
export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return isStandalone() ? signInWithRedirect(auth, provider) : signInWithPopup(auth, provider);
}

export function logout() {
  clearSnapshotCache();
  return signOut(auth);
}
