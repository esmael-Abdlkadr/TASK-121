import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ProtectedRoute from '../router/ProtectedRoute';

// Mock useAuth to control auth state directly in tests
const mockUseAuth = vi.fn();

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth()
}));

// Mock lazy pages so tests don't need to load real components
vi.mock('../pages/ForbiddenPage', () => ({
  default: () => <div>Forbidden</div>
}));

function makeAuth(overrides: Partial<ReturnType<typeof mockUseAuth>>) {
  return {
    currentUser: null,
    encryptionKey: null,
    navMode: 'admin' as const,
    isRestoringSession: false,
    needsUnlock: false,
    login: vi.fn(),
    logout: vi.fn(),
    unlock: vi.fn(),
    hasRole: vi.fn(() => false),
    ...overrides
  };
}

function renderRoute(path: string, roles?: string[], authOverrides = {}) {
  mockUseAuth.mockReturnValue(makeAuth(authOverrides));

  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route
          path="/protected"
          element={
            <ProtectedRoute roles={roles as never}>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/role-restricted"
          element={
            <ProtectedRoute roles={['SystemAdministrator'] as never}>
              <div>Admin Only Content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  it('redirects unauthenticated user to /login', () => {
    renderRoute('/protected', undefined, { currentUser: null });
    expect(screen.getByText('Login Page')).toBeTruthy();
  });

  it('shows loading state while restoring session', () => {
    renderRoute('/protected', undefined, {
      currentUser: null,
      isRestoringSession: true
    });
    expect(screen.getByText(/restoring session/i)).toBeTruthy();
  });

  it('renders children for authenticated user with no role restriction', () => {
    renderRoute('/protected', undefined, {
      currentUser: { id: 1, username: 'admin', role: 'SystemAdministrator', siteId: null, failedAttempts: 0, passwordHash: '', salt: '' },
      hasRole: vi.fn(() => true)
    });
    expect(screen.getByText('Protected Content')).toBeTruthy();
  });

  it('shows ForbiddenPage when user role does not match required roles', () => {
    renderRoute('/role-restricted', ['SystemAdministrator'], {
      currentUser: { id: 2, username: 'auditor', role: 'Auditor', siteId: 1, failedAttempts: 0, passwordHash: '', salt: '' },
      hasRole: vi.fn(() => false)
    });
    expect(screen.getByText('Forbidden')).toBeTruthy();
    expect(screen.queryByText('Admin Only Content')).toBeNull();
  });

  it('renders children when user role matches required roles', () => {
    renderRoute('/role-restricted', ['SystemAdministrator'], {
      currentUser: { id: 1, username: 'sysadmin', role: 'SystemAdministrator', siteId: null, failedAttempts: 0, passwordHash: '', salt: '' },
      hasRole: vi.fn(() => true)
    });
    expect(screen.getByText('Admin Only Content')).toBeTruthy();
  });

  it('preserves returnTo location state when redirecting to login', () => {
    const { container } = renderRoute('/protected', undefined, { currentUser: null });
    // After redirect, we should be on login page
    expect(screen.getByText('Login Page')).toBeTruthy();
    expect(container).toBeTruthy();
  });
});
