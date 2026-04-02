import { db } from '../db/db';
import type { User } from '../types';
import { assertCanMutate } from './rbacService';
import { reservationService } from './reservationService';
import { siteConfigService } from './siteConfigService';

async function tick(actor: User): Promise<void> {
  assertCanMutate(actor);
  const now = Date.now();
  const sessions = await db.sessions_charging
    .where('status')
    .equals('Active')
    .filter((session) =>
      actor.role === 'SystemAdministrator' ? true : session.siteId === actor.siteId
    )
    .toArray();

  for (const session of sessions) {
    await db.sessions_charging.update(session.id as number, {
      heartbeatAt: now,
      version: session.version + 1
    });
  }
}

async function checkAnomalies(actor: User): Promise<void> {
  assertCanMutate(actor);
  const siteId = actor.siteId;
  const now = Date.now();

  const targetSites =
    actor.role === 'SystemAdministrator'
      ? await db.sites.toArray().then((sites) => sites.map((site) => site.id as number))
      : [siteId as number];

  for (const currentSiteId of targetSites) {
    const config = siteConfigService.getSiteConfig(currentSiteId);
    const heartbeatCutoff = now - config.anomalyHeartbeatTimeoutMin * 60_000;
    const tempLeaveCutoff = now - config.tempLeaveMaxMinutes * 60_000;

    const noHeartbeat = await db.sessions_charging
      .where('status')
      .equals('Active')
      .filter((session) => session.siteId === currentSiteId && session.heartbeatAt < heartbeatCutoff)
      .toArray();

    for (const session of noHeartbeat) {
      await reservationService.flagAnomaly(session.id as number, `No heartbeat for ${config.anomalyHeartbeatTimeoutMin}+ minutes`, actor);
    }

    const tempLeaveExceeded = await db.sessions_charging
      .where('status')
      .equals('TempLeave')
      .filter(
        (session) =>
          session.siteId === currentSiteId &&
          typeof session.tempLeaveStartedAt === 'number' &&
          session.tempLeaveStartedAt < tempLeaveCutoff
      )
      .toArray();

    for (const session of tempLeaveExceeded) {
      await reservationService.flagAnomaly(session.id as number, 'Temp leave duration exceeded', actor);
    }
  }
}

export const heartbeatService = {
  tick,
  checkAnomalies
};
