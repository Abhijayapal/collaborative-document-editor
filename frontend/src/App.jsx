import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage     from "./pages/LoginPage";
import RegisterPage  from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import EditorPage    from "./pages/EditorPage";

// These guards call useAuth() — they MUST render inside <AuthProvider>
function PrivateRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { user } = useAuth();
  return user ? <Navigate to="/dashboard" replace /> : children;
}

// Routes is a separate component so AuthProvider wraps it (useAuth works correctly)
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route path="/login" element={
        <PublicRoute><LoginPage /></PublicRoute>
      } />

      <Route path="/register" element={
        <PublicRoute><RegisterPage /></PublicRoute>
      } />

      <Route path="/dashboard" element={
        <PrivateRoute><DashboardPage /></PrivateRoute>
      } />

      <Route path="/doc/:id" element={
        <PrivateRoute><EditorPage /></PrivateRoute>
      } />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* AppRoutes is a child of AuthProvider so useAuth() works in guards */}
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
