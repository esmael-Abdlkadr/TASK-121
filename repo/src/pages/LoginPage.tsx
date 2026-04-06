import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AuthLockedError, AuthWrongPasswordError } from '../services/authService';

export default function LoginPage() {
  const { currentUser, login, navMode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
    navigate(returnTo ?? (navMode === 'kiosk' ? '/kiosk' : '/admin/dashboard'), { replace: true });
  }, [currentUser, location.state, navigate, navMode]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);

    try {
      await login(username.trim(), password);
    } catch (submitError) {
      let message = 'Login failed';
      if (submitError instanceof AuthWrongPasswordError) {
        message = 'Invalid username or password';
      } else if (submitError instanceof AuthLockedError) {
        const minutes = Math.max(1, Math.ceil(submitError.remainingMs / 60_000));
        message = `Account locked. Try again in ${minutes} minutes.`;
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="login-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>ChargeBay Offline Operations Console</h1>
        <p>Sign in with your local account.</p>

        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          required
          disabled={busy}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          disabled={busy}
        />

        {error ? <p className="error">{error}</p> : null}

        <button className="button primary" type="submit" disabled={busy}>
          {busy ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </section>
  );
}
