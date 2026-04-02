import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AdminShell from '../components/Layout/AdminShell';
import KioskShell from '../components/Layout/KioskShell';
import ProtectedRoute from './ProtectedRoute';

const AdminDashboardPage = lazy(() => import('../pages/AdminDashboardPage'));
const AuditLogPage = lazy(() => import('../pages/AuditLogPage'));
const DataQualityPage = lazy(() => import('../pages/DataQualityPage'));
const ImportPage = lazy(() => import('../pages/ImportPage'));
const KioskDashboardPage = lazy(() => import('../pages/KioskDashboardPage'));
const LoginPage = lazy(() => import('../pages/LoginPage'));
const NotificationsPage = lazy(() => import('../pages/NotificationsPage'));
const ReservationsPage = lazy(() => import('../pages/ReservationsPage'));
const SessionsOrdersPage = lazy(() => import('../pages/SessionsOrdersPage'));
const SiteConfigPage = lazy(() => import('../pages/SiteConfigPage'));
const UserManagementPage = lazy(() => import('../pages/UserManagementPage'));

export function AppRouter() {
  return (
    <Suspense fallback={<div className="page-loading">Loading...</div>}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/kiosk"
          element={
            <ProtectedRoute roles={['Attendant', 'SiteManager']}>
              <KioskShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<KioskDashboardPage />} />
          <Route
            path="reservations"
            element={
              <ProtectedRoute roles={['Attendant', 'SiteManager']}>
                <ReservationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="sessions"
            element={
              <ProtectedRoute roles={['Attendant', 'SiteManager']}>
                <SessionsOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="notifications"
            element={
              <ProtectedRoute roles={['Attendant', 'SiteManager']}>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['SystemAdministrator', 'Auditor', 'SiteManager', 'Attendant']}>
              <AdminShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route
            path="dashboard"
            element={
              <ProtectedRoute roles={['SystemAdministrator', 'Auditor']}>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="reservations"
            element={
              <ProtectedRoute roles={['SystemAdministrator']}>
                <ReservationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="sessions"
            element={
              <ProtectedRoute roles={['SystemAdministrator', 'Auditor']}>
                <SessionsOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="import"
            element={
              <ProtectedRoute roles={['SystemAdministrator', 'SiteManager']}>
                <ImportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="quality"
            element={
              <ProtectedRoute roles={['SystemAdministrator', 'Auditor', 'SiteManager']}>
                <DataQualityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="audit"
            element={
              <ProtectedRoute roles={['SystemAdministrator', 'Auditor']}>
                <AuditLogPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="config"
            element={
              <ProtectedRoute roles={['SystemAdministrator', 'SiteManager']}>
                <SiteConfigPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="notifications"
            element={
              <ProtectedRoute roles={['SystemAdministrator', 'SiteManager', 'Attendant', 'Auditor']}>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="users"
            element={
              <ProtectedRoute roles={['SystemAdministrator']}>
                <UserManagementPage />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
