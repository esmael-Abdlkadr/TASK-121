import { beforeEach, describe, expect, it } from 'vitest';
import { storageService } from '../services/storageService';

describe('storageService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('getTheme returns light by default', () => {
    expect(storageService.getTheme()).toBe('light');
  });

  it('getTheme returns dark when stored value is dark', () => {
    localStorage.setItem('cb_theme', 'dark');
    expect(storageService.getTheme()).toBe('dark');
  });

  it('setTheme persists theme and applies html attribute', () => {
    storageService.setTheme('dark');
    expect(localStorage.getItem('cb_theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applyTheme reads persisted value and applies html attribute', () => {
    localStorage.setItem('cb_theme', 'dark');
    storageService.applyTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('getLastSite returns null when key is missing', () => {
    expect(storageService.getLastSite()).toBeNull();
  });

  it('getLastSite returns null when key is invalid', () => {
    localStorage.setItem('cb_last_site', 'not-a-number');
    expect(storageService.getLastSite()).toBeNull();
  });

  it('getLastSite returns numeric value when key is valid', () => {
    localStorage.setItem('cb_last_site', '42');
    expect(storageService.getLastSite()).toBe(42);
  });

  it('setLastSite persists numeric value as string', () => {
    storageService.setLastSite(88);
    expect(localStorage.getItem('cb_last_site')).toBe('88');
  });
});
