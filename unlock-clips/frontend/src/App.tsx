import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import ClipEditorPage from "./pages/ClipEditorPage";
import CreatePage from "./pages/CreatePage";
import DashboardPage from "./pages/DashboardPage";
import ExportsPage from "./pages/ExportsPage";
import NotFoundPage from "./pages/NotFoundPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ProjectsPage from "./pages/ProjectsPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="criar" element={<CreatePage />} />
        <Route path="projetos" element={<ProjectsPage />} />
        <Route path="projetos/:projectId" element={<ProjectDetailPage />} />
        <Route path="projetos/:projectId/cortes/:clipId" element={<ClipEditorPage />} />
        <Route path="exportados" element={<ExportsPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
