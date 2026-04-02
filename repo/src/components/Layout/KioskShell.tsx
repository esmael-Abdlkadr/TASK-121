import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { storageService, type Theme } from '../../services/storageService';

function formatClock(now: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: 'short',
    day: '2-digit'
  }).format(now);
}

export default function KioskShell() {
  const { currentUser, logout } = useAuth();
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [theme, setThemeState] = useState<Theme>(() => storageService.getTheme());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    storageService.setTheme(next);
    setThemeState(next);
  };

  return (
    <div className="kiosk-shell">
      <header className="shell-topbar">
        <div>
          <strong>ChargeBay Site {currentUser?.siteId ?? '-'}</strong>
        </div>
        <div>{clock}</div>
        <div className="admin-header-right">
          <button className="button ghost" type="button" onClick={toggleTheme}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
          <button className="button ghost" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <main className="shell-main">
        <Outlet />
      </main>

      <nav className="kiosk-tabs">
        <NavLink to="/kiosk" end>
          Dashboard
        </NavLink>
        <NavLink to="/kiosk/reservations">Reservations</NavLink>
        <NavLink to="/kiosk/sessions">Sessions</NavLink>
        <NavLink to="/kiosk/notifications">Notifications</NavLink>
        {currentUser?.role === 'SiteManager' ? (
          <>
            <NavLink to="/admin/import">Import</NavLink>
            <NavLink to="/admin/config">Config</NavLink>
            <NavLink to="/admin/quality">Data Quality</NavLink>
          </>
        ) : null}
      </nav>
    </div>
  );
}
