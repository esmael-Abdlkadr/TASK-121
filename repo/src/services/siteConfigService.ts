import type { SiteConfig, User } from '../types';
import { auditService } from './auditService';
import { assertCanMutate, assertSiteScope } from './rbacService';

const DEFAULT_CONFIG = {
  tempLeaveMaxCount: 1,
  tempLeaveMaxMinutes: 15,
  anomalyHeartbeatTimeoutMin: 30,
  noShowGraceMinutes: 10,
  ratePerMinute: 0.5
};

function storageKey(siteId: number) {
  return `cb_site_config_${siteId}`;
}

function getSiteConfig(siteId: number): SiteConfig {
  const raw = localStorage.getItem(storageKey(siteId));
  if (!raw) {
    return { siteId, ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SiteConfig>;
    return {
      siteId,
      tempLeaveMaxCount: parsed.tempLeaveMaxCount ?? DEFAULT_CONFIG.tempLeaveMaxCount,
      tempLeaveMaxMinutes: parsed.tempLeaveMaxMinutes ?? DEFAULT_CONFIG.tempLeaveMaxMinutes,
      anomalyHeartbeatTimeoutMin:
        parsed.anomalyHeartbeatTimeoutMin ?? DEFAULT_CONFIG.anomalyHeartbeatTimeoutMin,
      noShowGraceMinutes: parsed.noShowGraceMinutes ?? DEFAULT_CONFIG.noShowGraceMinutes,
      ratePerMinute: parsed.ratePerMinute ?? DEFAULT_CONFIG.ratePerMinute
    };
  } catch {
    return { siteId, ...DEFAULT_CONFIG };
  }
}

async function saveSiteConfig(config: SiteConfig, actor?: User): Promise<void> {
  if (actor) {
    assertCanMutate(actor);
    assertSiteScope(actor, config.siteId);
  }
  localStorage.setItem(storageKey(config.siteId), JSON.stringify(config));
  if (actor) {
    await auditService.log(actor, 'PRICING_UPDATED', 'SiteConfig', config.siteId, {
      ratePerMinute: config.ratePerMinute
    });
  }
}

export const siteConfigService = {
  getSiteConfig,
  saveSiteConfig
};
