import { db } from '../db/db';
import type { SiteConfig, User } from '../types';
import { auditService } from './auditService';
import { assertManagerOrAdmin, assertSiteScope } from './rbacService';

const DEFAULT_CONFIG: Omit<SiteConfig, 'siteId'> = {
  tempLeaveMaxCount: 1,
  tempLeaveMaxMinutes: 15,
  anomalyHeartbeatTimeoutMin: 30,
  noShowGraceMinutes: 10,
  ratePerMinute: 0.5
};

const configCache = new Map<number, SiteConfig>();

function buildConfig(siteId: number, partial: Partial<SiteConfig>): SiteConfig {
  return {
    siteId,
    tempLeaveMaxCount: partial.tempLeaveMaxCount ?? DEFAULT_CONFIG.tempLeaveMaxCount,
    tempLeaveMaxMinutes: partial.tempLeaveMaxMinutes ?? DEFAULT_CONFIG.tempLeaveMaxMinutes,
    anomalyHeartbeatTimeoutMin:
      partial.anomalyHeartbeatTimeoutMin ?? DEFAULT_CONFIG.anomalyHeartbeatTimeoutMin,
    noShowGraceMinutes: partial.noShowGraceMinutes ?? DEFAULT_CONFIG.noShowGraceMinutes,
    ratePerMinute: partial.ratePerMinute ?? DEFAULT_CONFIG.ratePerMinute
  };
}

/**
 * Synchronous read from in-memory cache. The cache is populated by:
 *  - `loadSiteConfig()` at app boot (reads from IndexedDB)
 *  - `saveSiteConfig()` on every write (writes IndexedDB first, then updates cache)
 *
 * If the cache is cold (before boot hydration), falls back to defaults.
 * This is intentional: callers that need guaranteed fresh data should
 * await `loadSiteConfig()` first.
 */
function getSiteConfig(siteId: number): SiteConfig {
  const cached = configCache.get(siteId);
  if (cached) return cached;
  return { siteId, ...DEFAULT_CONFIG };
}

/**
 * Async IndexedDB-first load. Called at app boot and whenever the
 * authoritative value is needed after a potential external change.
 * Populates the in-memory cache so subsequent sync reads are fast.
 */
async function loadSiteConfig(siteId: number): Promise<SiteConfig> {
  const stored = await db.siteConfigs.get(siteId).catch(() => undefined);
  if (stored) {
    const config = buildConfig(siteId, stored);
    configCache.set(siteId, config);
    return config;
  }
  const fallback = { siteId, ...DEFAULT_CONFIG };
  configCache.set(siteId, fallback);
  return fallback;
}

/**
 * Internal bootstrap-only write. Populates default config on first run
 * without requiring an authenticated actor. NOT for feature/UI paths.
 */
async function bootstrapSiteConfig(config: SiteConfig): Promise<void> {
  await db.siteConfigs.put({ ...config, id: config.siteId });
  configCache.set(config.siteId, config);
  localStorage.setItem(`cb_site_config_${config.siteId}`, JSON.stringify(config));
}

/**
 * Write to IndexedDB (authoritative), then update the in-memory cache.
 * Also mirrors to localStorage for backward compat with any stale readers.
 * Actor is mandatory — all feature-path writes require RBAC checks.
 */
async function saveSiteConfig(config: SiteConfig, actor: User): Promise<void> {
  if (!actor) throw new Error('RBAC_ACTOR_REQUIRED');
  assertManagerOrAdmin(actor);
  assertSiteScope(actor, config.siteId);
  await db.siteConfigs.put({ ...config, id: config.siteId });
  configCache.set(config.siteId, config);
  localStorage.setItem(`cb_site_config_${config.siteId}`, JSON.stringify(config));
  await auditService.log(actor, 'PRICING_UPDATED', 'SiteConfig', config.siteId, {
    ratePerMinute: config.ratePerMinute
  });
}

export const siteConfigService = {
  getSiteConfig,
  loadSiteConfig,
  saveSiteConfig,
  bootstrapSiteConfig
};
