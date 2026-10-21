import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout.jsx';
import AdminLayout from '../components/layout/AdminLayout.jsx';
import ProtectedRoute from './ProtectedRoute.jsx';
import AdminRoute from './AdminRoute.jsx';

import Login from '../pages/auth/Login.jsx';
import Signup from '../pages/auth/Signup.jsx';
import ForgotPassword from '../pages/auth/ForgotPassword.jsx';
import ResetPassword from '../pages/auth/ResetPassword.jsx';

import CreateInfographic from '../pages/CreateInfographic.jsx';
import MyGenerations from '../pages/MyGenerations.jsx';
import GenerationDetails from '../pages/GenerationDetails.jsx';
import ApiSettings from '../pages/ApiSettings.jsx';
import McpConnection from '../pages/McpConnection.jsx';
import ConnectConsent from '../pages/ConnectConsent.jsx';
import AccountSettings from '../pages/AccountSettings.jsx';
import NotFound from '../pages/NotFound.jsx';

import AdminDashboard from '../pages/admin/AdminDashboard.jsx';
import Users from '../pages/admin/Users.jsx';
import UserDetails from '../pages/admin/UserDetails.jsx';
import AdminGenerations from '../pages/admin/AdminGenerations.jsx';
import Jobs from '../pages/admin/Jobs.jsx';
import Failures from '../pages/admin/Failures.jsx';
import AdminMcp from '../pages/admin/AdminMcp.jsx';
import Providers from '../pages/admin/Providers.jsx';
import AccessSettings from '../pages/admin/AccessSettings.jsx';
import AuditLogs from '../pages/admin/AuditLogs.jsx';
import Operations from '../pages/admin/Operations.jsx';
import Branding from '../pages/admin/Branding.jsx';

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public auth pages */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/register" element={<Navigate to="/signup" replace />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Authenticated app */}
      <Route element={<ProtectedRoute />}>
        {/* Focused page opened from an AI app: the OAuth consent */}
        <Route path="connect/approve" element={<ConnectConsent />} />

        <Route element={<AppLayout />}>
          <Route index element={<CreateInfographic />} />
          <Route path="generations" element={<MyGenerations />} />
          <Route path="generations/:id" element={<GenerationDetails />} />

          <Route path="settings/api" element={<ApiSettings />} />
          <Route path="settings/account" element={<AccountSettings />} />
          <Route path="mcp" element={<McpConnection />} />
          <Route path="connect" element={<Navigate to="/mcp" replace />} />

          <Route path="admin" element={<AdminRoute />}>
            <Route element={<AdminLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<AdminDashboard />} />
              <Route path="users" element={<Users />} />
              <Route path="users/:id" element={<UserDetails />} />
              <Route path="generations" element={<AdminGenerations />} />
              <Route path="jobs" element={<Jobs />} />
              <Route path="failures" element={<Failures />} />
              <Route path="mcp" element={<AdminMcp />} />
              <Route path="connections" element={<Navigate to="/admin/mcp" replace />} />
              <Route path="providers" element={<Providers />} />
              <Route path="access" element={<AccessSettings />} />
              <Route path="audit-logs" element={<AuditLogs />} />
              <Route path="operations" element={<Operations />} />
              <Route path="branding" element={<Branding />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
