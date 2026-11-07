import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
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

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<RequireAuth><ListPage /></RequireAuth>} />
            <Route path="/new" element={<RequireAuth><NewTankaPage /></RequireAuth>} />
            <Route path="/t/:tankaId/edit" element={<RequireAuth><EditPage /></RequireAuth>} />
            <Route path="/t/:tankaId/reading" element={<RequireAuth><ReadingPage /></RequireAuth>} />
            <Route path="/t/:tankaId/r/:revisionId" element={<RequireAuth><ResultPage /></RequireAuth>} />
            <Route path="/t/:tankaId/r/:revisionId/f/:fingerprint" element={<RequireAuth><FindingPage /></RequireAuth>} />
            <Route path="/t/:tankaId/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
            <Route path="/t/:tankaId/compare" element={<RequireAuth><ComparePage /></RequireAuth>} />
            <Route path="/t/:tankaId/hidden" element={<RequireAuth><HiddenPage /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
            <Route path="/patterns" element={<PatternsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
