import { db } from '../db/db';
import type { User } from '../types';
import { auditService } from './auditService';
import { notificationService } from './notificationService';
import { orderService } from './orderService';
import { assertCanMutate, assertSiteScope } from './rbacService';

function assertManagerOrAdmin(actor: User) {
  if (actor.role !== 'SystemAdministrator' && actor.role !== 'SiteManager') {
    throw new Error('RBAC_SCOPE_VIOLATION');
  }
}

async function completeSession(sessionId: number, actor: User): Promise<void> {
  assertCanMutate(actor);
  const session = await db.sessions_charging.get(sessionId);
  if (!session || session.status !== 'Active') {
    throw new Error('SESSION_INVALID_STATE');
  }
  assertSiteScope(actor, session.siteId);

  const now = Date.now();
  await db.sessions_charging.update(sessionId, {
    status: 'Completed',
    endedAt: now,
    version: session.version + 1
  });
  await db.bays.update(session.bayId, { status: 'Available' });
  await db.reservations.update(session.reservationId, { status: 'Completed' });
  await orderService.generateOrder(sessionId, actor);
  await notificationService.sendTemplateToSiteStaff(session.siteId, 'HOLD_AVAILABLE', actor, {
    bayLabel: String(session.bayId)
  });
  await auditService.log(actor, 'SESSION_COMPLETED', 'ChargingSession', sessionId);
}

async function resolveAnomaly(
  sessionId: number,
  resolution: 'complete' | 'cancel',
  reason: string,
  actor: User
): Promise<void> {
  assertManagerOrAdmin(actor);
  if (reason.trim().length < 10) {
    throw new Error('ANOMALY_REASON_TOO_SHORT');
  }

  const session = await db.sessions_charging.get(sessionId);
  if (!session || session.status !== 'Anomaly') {
    throw new Error('SESSION_INVALID_STATE');
  }
  assertSiteScope(actor, session.siteId);

  if (resolution === 'complete') {
    await db.sessions_charging.update(sessionId, { status: 'Active' });
    await completeSession(sessionId, actor);
  } else {
    const now = Date.now();
    await db.sessions_charging.update(sessionId, {
      status: 'Completed',
      endedAt: now,
      anomalyReason: `${session.anomalyReason ?? ''} | cancelled: ${reason}`,
      version: session.version + 1
    });
    await db.reservations.update(session.reservationId, { status: 'Cancelled' });
    await db.bays.update(session.bayId, { status: 'Available' });
    await notificationService.sendTemplateToSiteStaff(session.siteId, 'HOLD_AVAILABLE', actor, {
      bayLabel: String(session.bayId)
    });
  }

  await auditService.log(actor, 'ANOMALY_RESOLVED', 'ChargingSession', sessionId, {
    resolution,
    reason
  });
}

export const sessionService = {
  completeSession,
  resolveAnomaly
};
