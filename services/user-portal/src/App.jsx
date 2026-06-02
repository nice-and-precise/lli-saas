import { Navigate, Route, Routes } from "react-router-dom";

import DashboardPage from "./pages/DashboardPage";
import WelcomePage from "./pages/WelcomePage";

export default function App() {
  return (
    <Routes>
      {/* The dashboard is the single operator surface. The old /login stub was a
          dead-end fake form; route any legacy links straight to the dashboard. */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      {/* Shareable getting-started page for a brand-new broker. */}
      <Route path="/welcome" element={<WelcomePage />} />
    </Routes>
  );
}
