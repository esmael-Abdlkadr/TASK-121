import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ForbiddenPage from '../pages/ForbiddenPage';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  roles?: UserRole[];
  children: ReactNode;
}

export default function ProtectedRoute({ roles, children }: ProtectedRouteProps) {
  const { currentUser, hasRole, isRestoringSession } = useAuth();
  const location = useLocation();

  if (isRestoringSession) {
    return <div className="page-loading">Restoring session...</div>;
  }

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ returnTo: location.pathname }} />;
  }

  if (roles && !hasRole(...roles)) {
    return <ForbiddenPage />;
  }

  return <>{children}</>;
}
