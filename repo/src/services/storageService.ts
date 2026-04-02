const THEME_KEY = 'cb_theme';
const LAST_SITE_KEY = 'cb_last_site';

export type Theme = 'light' | 'dark';

function getTheme(): Theme {
  const raw = localStorage.getItem(THEME_KEY);
  return raw === 'dark' ? 'dark' : 'light';
}

function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

function applyTheme(): void {
  const theme = getTheme();
  document.documentElement.setAttribute('data-theme', theme);
}

function getLastSite(): number | null {
  const raw = localStorage.getItem(LAST_SITE_KEY);
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}

function setLastSite(siteId: number): void {
  localStorage.setItem(LAST_SITE_KEY, String(siteId));
}

export const storageService = {
  getTheme,
  setTheme,
  applyTheme,
  getLastSite,
  setLastSite
};
