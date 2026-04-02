import { FormEvent, useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { heartbeatService } from './services/heartbeatService';
import { notificationService } from './services/notificationService';
import { qualityService } from './services/qualityService';
import { reservationService } from './services/reservationService';
import { tieringService } from './services/tieringService';
import { AppRouter } from './router';

function UnlockModal() {
  const { needsUnlock, unlock, logout, currentUser } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!needsUnlock || !currentUser) {
    return null;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await unlock(password);
    } catch {
      setError('Incorrect password. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <form className="modal" onSubmit={onSubmit}>
        <h3>Session Restored</h3>
        <p>
          Welcome back, <strong>{currentUser.username}</strong>. Please re-enter your password to
          unlock encrypted data access.
        </p>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoFocus
          autoComplete="current-password"
        />
        {error ? <p className="error">{error}</p> : null}
        <div className="modal-actions">
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? 'Unlocking...' : 'Unlock'}
          </button>
          <button className="button ghost" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </form>
    </div>
  );
}

function Runtime() {
  const { currentUser } = useAuth();
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const siteId = currentUser.siteId;
    const canMutate = currentUser.role !== 'Auditor';
    if (siteId && canMutate) {
      void qualityService.runWeeklyIfDue(siteId, currentUser);
      void tieringService.runTiering(siteId, currentUser);
    }

    // heartbeatAt is updated only by real user actions (confirmArrival, endTempLeave).
    // Auto-ticking every session would prevent the 30-min stale-heartbeat anomaly rule
    // from ever firing while the app is open, so no periodic tick is scheduled here.
    const anomalyTimer = window.setInterval(() => {
      if (canMutate) void heartbeatService.checkAnomalies(currentUser);
    }, 60_000);

    const noShowTimer = window.setInterval(() => {
      if (canMutate) void reservationService.autoProcessNoShows(currentUser);
    }, 60_000);

    const notifRetryTimer = window.setInterval(() => {
      if (canMutate) void notificationService.retryFailed();
    }, 30_000);

    const notifRuleTimer = window.setInterval(() => {
      if (canMutate) void notificationService.runDueAndOverdueSchedulers(currentUser);
    }, 60_000);

    const clearBanner = window.setInterval(() => setBanner(null), 5_000);
    const tieringTimer = window.setInterval(() => {
      if (siteId && canMutate) {
        void tieringService.runTiering(siteId, currentUser);
      }
    }, 24 * 60 * 60 * 1000);
    notificationService.setBannerListener((subject, userId) => {
      if (currentUser.id === userId) {
        setBanner(subject);
      }
    });

    return () => {
      window.clearInterval(anomalyTimer);
      window.clearInterval(noShowTimer);
      window.clearInterval(notifRetryTimer);
      window.clearInterval(notifRuleTimer);
      window.clearInterval(clearBanner);
      window.clearInterval(tieringTimer);
      notificationService.setBannerListener(null);
    };
  }, [currentUser]);

  if (!banner) {
    return null;
  }

  return <div className="notif-banner">{banner}</div>;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <UnlockModal />
        <Runtime />
        <AppRouter />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
