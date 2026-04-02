import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../../pages/LoginPage';
import { AuthLockedError } from '../../services/authService';

const navigateMock = vi.fn();
const loginMock = vi.fn();

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: null,
    login: loginMock,
    navMode: 'kiosk'
  })
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ state: null })
  };
});

describe('LoginPage', () => {
  beforeEach(() => {
    loginMock.mockReset();
    navigateMock.mockReset();
  });

  it('renders username and password inputs', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </MemoryRouter>
    );
    expect(screen.getByLabelText(/username/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
  });

  it('shows lockout message on AUTH_LOCKED', async () => {
    loginMock.mockRejectedValueOnce(new AuthLockedError(120_000));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginPage />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));
    expect(await screen.findByText(/account locked/i)).toBeTruthy();
  });
});
