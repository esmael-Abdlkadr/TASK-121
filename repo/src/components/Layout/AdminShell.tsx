import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { storageService, type Theme } from '../../services/storageService';
import Sidebar from './Sidebar';

function formatClock(now: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: 'short',
    day: '2-digit'
  }).format(now);
}

export default function AdminShell() {
  const { currentUser, logout } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
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
    <div className="admin-shell">
      {!isCollapsed && <Sidebar />}
      <div className="admin-content">
        <header className="shell-topbar">
          <div className="admin-header-left">
            <button className="button ghost" type="button" onClick={() => setIsCollapsed((v) => !v)}>
              {isCollapsed ? 'Open Menu' : 'Collapse Menu'}
            </button>
            <strong>{currentUser?.username}</strong>
          </div>
          <div>{clock}</div>
          <div className="admin-header-right">
            <button className="button ghost" type="button" onClick={toggleTheme}>
              {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
            </button>
            <button className="button ghost" type="button" onClick={logout}>
              Logout
            </button>
          </div>
        </header>
        <main className="shell-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
