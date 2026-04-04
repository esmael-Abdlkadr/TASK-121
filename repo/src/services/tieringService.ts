import { db } from '../db/db';
import type { User } from '../types';
import { auditService } from './auditService';
import { assertManagerOrAdmin, assertSiteScope } from './rbacService';

export interface TieringResult {
  reservationsArchived: number;
  sessionsArchived: number;
  ordersArchived: number;
}

async function runTiering(siteId: number, actor: User): Promise<TieringResult> {
  assertManagerOrAdmin(actor);
  assertSiteScope(actor, siteId);
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  let reservationsArchived = 0;
  let sessionsArchived = 0;
  let ordersArchived = 0;

  const reservations = await db.reservations
    .where('siteId')
    .equals(siteId)
    .filter((r) => r.scheduledStart < cutoff)
    .toArray();
  await db.transaction('rw', db.reservations, db.reservations_cold, async () => {
    for (const row of reservations) {
      const { id, ...rest } = row;
      await db.reservations_cold.add({
        ...rest,
        originalId: id as number,
        archivedAt: Date.now()
      });
      await db.reservations.delete(id as number);
      reservationsArchived += 1;
    }
  });

  const sessions = await db.sessions_charging
    .where('siteId')
    .equals(siteId)
    .filter((s) => s.startedAt < cutoff)
    .toArray();
  await db.transaction('rw', db.sessions_charging, db.sessions_cold, async () => {
    for (const row of sessions) {
      const { id, ...rest } = row;
      await db.sessions_cold.add({
        ...rest,
        originalId: id as number,
        archivedAt: Date.now()
      });
      await db.sessions_charging.delete(id as number);
      sessionsArchived += 1;
    }
  });

  const orders = await db.orders
    .where('siteId')
    .equals(siteId)
    .filter((o) => (o as { createdAt?: number }).createdAt ? (o as { createdAt: number }).createdAt < cutoff : false)
    .toArray();
  await db.transaction('rw', db.orders, db.orders_cold, async () => {
    for (const row of orders) {
      const { id, ...rest } = row;
      await db.orders_cold.add({
        ...rest,
        originalId: id as number,
        archivedAt: Date.now()
      });
      await db.orders.delete(id as number);
      ordersArchived += 1;
    }
  });

  localStorage.setItem(
    `cb_tiering_last_${siteId}`,
    JSON.stringify({
      ranAt: Date.now(),
      reservationsArchived,
      sessionsArchived,
      ordersArchived
    })
  );
  await auditService.log(actor, 'TIERING_RUN', 'Site', siteId, {
    reservationsArchived,
    sessionsArchived,
    ordersArchived
  });

  return { reservationsArchived, sessionsArchived, ordersArchived };
}

async function queryColdReservations(siteId: number): Promise<import('../types').ArchivedReservation[]> {
  return db.reservations_cold.where('siteId').equals(siteId).toArray();
}

export const tieringService = {
  runTiering,
  queryColdReservations
};
