import { db } from '../db/db';
import type { ChargingSession, Reservation, User } from '../types';
import { auditService } from './auditService';
import { cryptoService } from './cryptoService';
import { notificationService } from './notificationService';
import { qrService } from './qrService';
import { rateLimiter } from './rateLimiter';
import { assertCanMutate, assertSiteScope } from './rbacService';
import { siteConfigService } from './siteConfigService';

interface CreateReservationInput {
  operationId: string;
  bayId: number;
  siteId: number;
  userId: number;
  customerName: string;
  customerPlate: string;
  scheduledStart: number;
  scheduledEnd: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export class BayConflictError extends Error {
  code = 'RES_BAY_CONFLICT' as const;

  constructor() {
    super('RES_BAY_CONFLICT');
  }
}

export class TempLeaveLimitError extends Error {
  code = 'TEMPLEAVE_LIMIT_REACHED' as const;

  constructor() {
    super('TEMPLEAVE_LIMIT_REACHED');
  }
}

async function createReservation(
  data: CreateReservationInput,
  actor: User,
  encryptionKey: CryptoKey
): Promise<Reservation> {
  assertCanMutate(actor);
  assertSiteScope(actor, data.siteId);
  const now = Date.now();
  if (data.scheduledStart >= data.scheduledEnd || data.scheduledStart <= now) {
    throw new Error('RES_INVALID_TIME_WINDOW');
  }

  const existing = await db.reservations.where('operationId').equals(data.operationId).first();
  if (existing) {
    return existing;
  }

  const activeReservations = await db.reservations
    .where('bayId')
    .equals(data.bayId)
    .filter((item) => ['Scheduled', 'CheckedIn', 'Active'].includes(item.status))
    .toArray();

  const hasConflict = activeReservations.some((item) =>
    overlaps(data.scheduledStart, data.scheduledEnd, item.scheduledStart, item.scheduledEnd)
  );
  if (hasConflict) {
    throw new BayConflictError();
  }

  const site = await db.sites.get(data.siteId);
  const config = siteConfigService.getSiteConfig(data.siteId);

  // Add the reservation first so we obtain the real persisted primary key.
  // The QR payload must embed the real reservationId, so it is generated and
  // written back after the initial insert.
  const reservationId = await db.reservations.add({
    operationId: data.operationId,
    bayId: data.bayId,
    siteId: data.siteId,
    userId: data.userId,
    customerName: await cryptoService.encryptField(data.customerName, encryptionKey),
    customerPlate: await cryptoService.encryptField(data.customerPlate, encryptionKey),
    scheduledStart: data.scheduledStart,
    scheduledEnd: data.scheduledEnd,
    status: 'Scheduled',
    noShowDeadline: data.scheduledStart + config.noShowGraceMinutes * 60_000,
    version: 1
  });

  // Bind QR to the real persisted reservation identity.
  const qrPayload = qrService.encodePayload({
    reservationId: reservationId as number,
    operationId: data.operationId,
    siteCode: site?.siteCode ?? 'UNKNOWN'
  });
  await db.reservations.update(reservationId, { qrCode: qrPayload });

  await db.bays.update(data.bayId, { status: 'Reserved' });
  await auditService.log(actor, 'RESERVATION_CREATED', 'Reservation', reservationId, {
    bayId: data.bayId,
    scheduledStart: data.scheduledStart
  });

  const created = await db.reservations.get(reservationId);
  return created as Reservation;
}

async function confirmArrival(
  reservationId: number,
  method: 'manual' | 'qr',
  actor: User,
  qrPayload?: string
): Promise<ChargingSession> {
  assertCanMutate(actor);
  const reservation = await db.reservations.get(reservationId);
  if (!reservation || reservation.status !== 'Scheduled') {
    throw new Error('RES_CONFIRM_INVALID_STATE');
  }
  assertSiteScope(actor, reservation.siteId);

  if (method === 'qr') {
    if (!qrPayload) {
      throw new Error('RES_QR_MISSING');
    }
    const parsed = qrService.parsePayload(qrPayload);
    const site = await db.sites.get(reservation.siteId);
    if (
      parsed.reservationId !== reservation.id ||
      parsed.operationId !== reservation.operationId ||
      parsed.siteCode !== (site?.siteCode ?? 'UNKNOWN')
    ) {
      throw new Error('RES_QR_MISMATCH');
    }
  }

  const now = Date.now();
  await db.reservations.update(reservationId, {
    status: 'CheckedIn',
    confirmedArrivalAt: now,
    confirmedBy: actor.id,
    version: reservation.version + 1
  });
  await db.bays.update(reservation.bayId, { status: 'Occupied' });

  const session: ChargingSession = {
    reservationId,
    bayId: reservation.bayId,
    siteId: reservation.siteId,
    startedAt: now,
    status: 'Active',
    heartbeatAt: now,
    tempLeaveCount: 0,
    version: 1,
    ...(reservation.importBatchId !== undefined ? { importBatchId: reservation.importBatchId } : {}),
    ...(reservation.importRowId !== undefined ? { importRowId: reservation.importRowId } : {})
  };
  const sessionId = await db.sessions_charging.add(session);

  await db.reservations.update(reservationId, { status: 'Active' });
  await auditService.log(actor, 'ARRIVAL_CONFIRMED', 'Reservation', reservationId, {
    method,
    sessionId
  });

  const created = await db.sessions_charging.get(sessionId);
  return created as ChargingSession;
}

async function autoProcessNoShows(actor?: User): Promise<void> {
  if (actor) {
    assertCanMutate(actor);
  }
  const now = Date.now();
  const due = await db.reservations
    .where('status')
    .equals('Scheduled')
    .filter((item) => item.noShowDeadline <= now)
    .toArray();

  for (const reservation of due) {
    await db.reservations.update(reservation.id as number, {
      status: 'NoShow',
      version: reservation.version + 1
    });
    await db.bays.update(reservation.bayId, { status: 'Available' });

    if (actor) {
      await auditService.log(actor, 'RESERVATION_NO_SHOW', 'Reservation', reservation.id as number);
    }
    await notificationService.sendTemplateToSiteStaff(
      reservation.siteId,
      'NO_SHOW_CANCELLED',
      actor,
      {
        reservationId: String(reservation.id ?? ''),
        time: new Date(now).toLocaleTimeString()
      }
    );
    await notificationService.sendTemplateToSiteStaff(
      reservation.siteId,
      'HOLD_AVAILABLE',
      actor,
      { bayLabel: String(reservation.bayId) }
    );
  }
}

async function flagAnomaly(sessionId: number, reason: string, actor: User): Promise<void> {
  assertCanMutate(actor);
  const session = await db.sessions_charging.get(sessionId);
  if (!session) {
    throw new Error('SESSION_NOT_FOUND');
  }
  assertSiteScope(actor, session.siteId);

  await db.sessions_charging.update(sessionId, {
    status: 'Anomaly',
    anomalyReason: reason,
    version: session.version + 1
  });
  await db.bays.update(session.bayId, { status: 'Anomaly' });
  await notificationService.sendTemplateToSiteStaff(session.siteId, 'OCCUPANCY_ANOMALY', actor, {
    bayLabel: String(session.bayId),
    reason
  });
  await auditService.log(actor, 'SESSION_ANOMALY_FLAGGED', 'ChargingSession', sessionId, { reason });
}

async function startTempLeave(sessionId: number, actor: User): Promise<void> {
  assertCanMutate(actor);
  const session = await db.sessions_charging.get(sessionId);
  if (!session || session.status !== 'Active') {
    throw new Error('SESSION_INVALID_STATE');
  }
  assertSiteScope(actor, session.siteId);

  const config = siteConfigService.getSiteConfig(session.siteId);
  if (session.tempLeaveCount >= config.tempLeaveMaxCount) {
    // Prompt requires: exceeding temp-leave count limit triggers Unverified Occupancy anomaly.
    await flagAnomaly(sessionId, 'Unverified Occupancy: temp leave count limit exceeded', actor);
    throw new TempLeaveLimitError();
  }

  await db.sessions_charging.update(sessionId, {
    status: 'TempLeave',
    tempLeaveStartedAt: Date.now(),
    version: session.version + 1
  });
  await auditService.log(actor, 'TEMP_LEAVE_STARTED', 'ChargingSession', sessionId);
}

async function endTempLeave(sessionId: number, actor: User): Promise<void> {
  assertCanMutate(actor);
  const session = await db.sessions_charging.get(sessionId);
  if (!session || session.status !== 'TempLeave') {
    throw new Error('SESSION_INVALID_STATE');
  }
  assertSiteScope(actor, session.siteId);

  const now = Date.now();
  const config = siteConfigService.getSiteConfig(session.siteId);
  const duration = now - (session.tempLeaveStartedAt ?? now);

  if (duration > config.tempLeaveMaxMinutes * 60_000) {
    await flagAnomaly(sessionId, 'Temp leave duration exceeded', actor);
    return;
  }

  await db.sessions_charging.update(sessionId, {
    status: 'Active',
    tempLeaveStartedAt: undefined,
    tempLeaveCount: session.tempLeaveCount + 1,
    heartbeatAt: now,
    version: session.version + 1
  });
  await auditService.log(actor, 'TEMP_LEAVE_ENDED', 'ChargingSession', sessionId);
}

async function getReservationDetail(
  reservationId: number,
  actor: User,
  encryptionKey: CryptoKey
): Promise<Reservation | null> {
  const reservation = await db.reservations.get(reservationId);
  if (!reservation) {
    return null;
  }
  assertSiteScope(actor, reservation.siteId);

  return {
    ...reservation,
    customerName: await cryptoService.decryptField(reservation.customerName, encryptionKey),
    customerPlate: await cryptoService.decryptField(reservation.customerPlate, encryptionKey)
  };
}

async function bulkCancelReservations(reservationIds: number[], actor: User): Promise<void> {
  assertCanMutate(actor);
  const userId = actor.id as number;
  rateLimiter.check(userId, 'bulk_reservation_cancel', 100, 60_000, reservationIds.length);
  rateLimiter.record(userId, 'bulk_reservation_cancel', reservationIds.length);

  for (const reservationId of reservationIds) {
    const reservation = await db.reservations.get(reservationId);
    if (!reservation) {
      continue;
    }
    assertSiteScope(actor, reservation.siteId);
    await db.reservations.update(reservationId, { status: 'Cancelled', version: reservation.version + 1 });
    await db.bays.update(reservation.bayId, { status: 'Available' });
    await auditService.log(actor, 'RESERVATION_CANCELLED', 'Reservation', reservationId);
  }
}

export const reservationService = {
  createReservation,
  confirmArrival,
  autoProcessNoShows,
  startTempLeave,
  endTempLeave,
  flagAnomaly,
  getReservationDetail,
  bulkCancelReservations
};
