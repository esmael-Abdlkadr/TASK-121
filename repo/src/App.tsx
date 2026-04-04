import { FormEvent, useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { heartbeatService } from './services/heartbeatService';
import { notificationService } from './services/notificationService';
import { qualityService } from './services/qualityService';
import { reservationService } from './services/reservationService';
import { siteConfigService } from './services/siteConfigService';
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

    // Hydrate site config cache from IndexedDB before any timer reads it.
    if (siteId) {
      void siteConfigService.loadSiteConfig(siteId);
    }

    if (siteId && canMutate) {
      void qualityService.runWeeklyIfDue(siteId, currentUser);
      void tieringService.runTiering(siteId, currentUser);
    }

    // Tick heartbeat for all Active sessions every 5 minutes so normal long-running
    // sessions are not incorrectly escalated to Anomaly while the operator is present.
    // The anomaly check (every 1 min) only fires when the last tick is genuinely stale
    // – i.e. when the app has been closed/backgrounded beyond the configured timeout.
    if (canMutate) void heartbeatService.tick(currentUser);
    const heartbeatTickTimer = window.setInterval(() => {
      if (canMutate) void heartbeatService.tick(currentUser);
    }, 5 * 60_000);

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
      window.clearInterval(heartbeatTickTimer);
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
