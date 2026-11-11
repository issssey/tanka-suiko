import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType, useParams } from "react-router-dom";
import { useLayoutEffect, type ReactNode } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { useWide } from "./lib/responsive";
import { Loading } from "./components/ui";
import AppreciationPage from "./pages/Appreciation";
import PcAppreciation from "./pages/pc/PcAppreciation";
import NotesPage from "./pages/Notes";
import NotePage from "./pages/Note";
import NoteWritePage from "./pages/NoteWrite";
import PcNotes, { PcNote, PcNoteEditRedirect, PcNoteNew } from "./pages/pc/PcNotes";
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
import SequencesPage from "./pages/Sequences";
import SequencePage from "./pages/Sequence";
import PublicationsPage from "./pages/Publications";
import PublishPage from "./pages/Publish";
import PublicationPage from "./pages/Publication";
import PcSequences from "./pages/pc/PcSequences";
import PcPublications, { PcPublication, PcPublish } from "./pages/pc/PcPublications";

/**
 * 別の画面に移ったら、いちばん上から表示する（前の画面のスクロール位置のまま開くと、
 * ホーム画面から開いたときに見出しがステータスバーの下に隠れる）。戻る（POP）はブラウザに任せる。
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    if (type !== "POP") window.scrollTo(0, 0);
  }, [pathname, type]);
  return null;
}

function EditToDetail() {
  const { publicationId = "" } = useParams();
  return <Navigate to={`/publications/${publicationId}`} replace />;
}

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
        <Route path="/login" element={pick(<LoginPage />, <LoginPage pc />)} />
        <Route path="/" element={auth(pick(<ListPage />, <PcHome />))} />
        <Route path="/new" element={auth(pick(<NewTankaPage />, <PcWrite key="new" />))} />
        <Route path="/t/:tankaId/edit" element={auth(pick(<EditPage />, <PcWrite />))} />
        {/* PC版は書く画面で読みも確かめるので、確認画面はスマホ版だけ */}
        <Route path="/t/:tankaId/reading" element={auth(<ReadingPage />)} />
        <Route path="/t/:tankaId/r/:revisionId" element={auth(pick(<ResultPage />, <PcResult mode="list" />))} />
        <Route path="/t/:tankaId/r/:revisionId/appreciation" element={auth(pick(<AppreciationPage />, <PcAppreciation />))} />
        <Route path="/t/:tankaId/r/:revisionId/f/:fingerprint" element={auth(pick(<FindingPage />, <PcResult mode="finding" />))} />
        <Route path="/t/:tankaId/history" element={auth(pick(<HistoryPage />, <PcHistory />))} />
        <Route path="/t/:tankaId/compare" element={auth(pick(<ComparePage />, <PcHistory />))} />
        <Route path="/t/:tankaId/hidden" element={auth(pick(<HiddenPage />, <PcHidden />))} />
        <Route path="/notes" element={auth(pick(<NotesPage />, <PcNotes />))} />
        <Route path="/notes/new" element={auth(pick(<NoteWritePage key="new" />, <PcNoteNew />))} />
        <Route path="/notes/:noteId" element={auth(pick(<NotePage />, <PcNote />))} />
        <Route path="/notes/:noteId/edit" element={auth(pick(<NoteWritePage key="edit" />, <PcNoteEditRedirect />))} />
        <Route path="/sequences" element={auth(pick(<SequencesPage />, <PcSequences />))} />
        <Route path="/sequences/:sequenceId" element={auth(pick(<SequencePage />, <PcSequences />))} />
        <Route path="/publications" element={auth(pick(<PublicationsPage />, <PcPublications />))} />
        <Route path="/publications/:publicationId" element={auth(pick(<PublicationPage />, <PcPublication />))} />
        <Route path="/publish" element={auth(pick(<PublishPage />, <PcPublish />))} />
        {/* PC版は詳細の画面でその場で直すので、直す画面は詳細に移す */}
        <Route path="/publications/:publicationId/edit" element={auth(pick(<PublishPage key="edit" />, <EditToDetail />))} />
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
        <ScrollToTop />
        <Screens />
      </BrowserRouter>
    </AuthProvider>
  );
}
