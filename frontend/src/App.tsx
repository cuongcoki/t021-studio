import { Navigate, Route, Routes } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "./lib/useAuth";
import AppLayout from "./layout/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ProjectsPage from "./pages/ProjectsPage";
import TasksPage from "./pages/TasksPage";
import UsersPage from "./pages/UsersPage";
import SettingsPage from "./pages/SettingsPage";
import WorkspacePage from "./pages/workspace/WorkspacePage";
import PreviewPage from "./pages/workspace/PreviewPage";

export default function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (!user) return <LoginPage />;
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:taskId" element={<WorkspacePage />} />
        <Route path="preview" element={<PreviewPage />} />
        <Route path="users" element={user.role === "admin" ? <UsersPage /> : <Navigate to="/" replace />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
