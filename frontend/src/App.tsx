import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { useWide } from "./lib/responsive";
import { Loading } from "./components/ui";
import LoginPage from "./pages/Login";
import ListPage from "./pages/List";
import NewTankaPage from "./pages/NewTanka";
import EditPage from "./pages/Edit";
import ReadingPage from "./pages/Reading";
import ResultPage from "./pages/Result";
import FindingPage from "./pages/Finding";
import HistoryPage from "./pages/History";
import ComparePage from "./pages/Compare";
import HiddenPage from "./pages/Hidden";
import SettingsPage from "./pages/Settings";
import PatternsPage from "./pages/Patterns";
import PcHome from "./pages/pc/PcHome";
import PcWrite from "./pages/pc/PcWrite";
import PcResult from "./pages/pc/PcResult";
import PcHidden from "./pages/pc/PcHidden";
import PcHistory from "./pages/pc/PcHistory";
import PcSettings from "./pages/pc/PcSettings";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** 幅 1024px 以上ではPC版、それ以外はスマホ版を出す。 */
function Screens() {
  const wide = useWide();
  const pick = (mobile: ReactNode, pc: ReactNode) => (wide ? pc : mobile);
  const auth = (node: ReactNode) => <RequireAuth>{node}</RequireAuth>;
  return (
    <div className={wide ? "app wide" : "app"}>
      <Routes>
        <Route path="/login" element={pick(<LoginPage />, <div className="pc-center"><div style={{ maxWidth: 480 }}><LoginPage /></div></div>)} />
        <Route path="/" element={auth(pick(<ListPage />, <PcHome />))} />
        <Route path="/new" element={auth(pick(<NewTankaPage />, <PcWrite key="new" />))} />
        <Route path="/t/:tankaId/edit" element={auth(pick(<EditPage />, <PcWrite />))} />
        {/* PC版は書く画面で読みも確かめるので、確認画面はスマホ版だけ */}
        <Route path="/t/:tankaId/reading" element={auth(<ReadingPage />)} />
        <Route path="/t/:tankaId/r/:revisionId" element={auth(pick(<ResultPage />, <PcResult mode="list" />))} />
        <Route path="/t/:tankaId/r/:revisionId/f/:fingerprint" element={auth(pick(<FindingPage />, <PcResult mode="finding" />))} />
        <Route path="/t/:tankaId/history" element={auth(pick(<HistoryPage />, <PcHistory />))} />
        <Route path="/t/:tankaId/compare" element={auth(pick(<ComparePage />, <PcHistory />))} />
        <Route path="/t/:tankaId/hidden" element={auth(pick(<HiddenPage />, <PcHidden />))} />
        <Route path="/settings" element={auth(pick(<SettingsPage />, <PcSettings />))} />
        <Route path="/patterns" element={pick(<PatternsPage />, <RequireAuth><PcSettings /></RequireAuth>)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Screens />
      </BrowserRouter>
    </AuthProvider>
  );
}
