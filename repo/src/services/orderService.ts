import { db } from '../db/db';
import type { Order, User } from '../types';
import { auditService } from './auditService';
import { cryptoService } from './cryptoService';
import { notificationService } from './notificationService';
import { rateLimiter } from './rateLimiter';
import { assertCanMutate, assertSiteScope } from './rbacService';
import { siteConfigService } from './siteConfigService';

const ORDER_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function dateKey(value: number): string {
  return ORDER_DATE.format(new Date(value)).replaceAll('-', '');
}

function assertApprover(actor: User) {
  if (actor.role !== 'SystemAdministrator' && actor.role !== 'SiteManager') {
    throw new Error('RBAC_SCOPE_VIOLATION');
  }
}

async function generateOrder(sessionId: number, actor: User, encryptionKey?: CryptoKey): Promise<Order> {
  assertCanMutate(actor);
  const existing = await db.orders.where('sessionId').equals(sessionId).filter((o) => o.status !== 'Voided').first();
  if (existing) {
    return existing;
  }

  const session = await db.sessions_charging.get(sessionId);
  if (!session || session.status !== 'Completed' || !session.endedAt) {
    throw new Error('ORDER_SESSION_NOT_COMPLETED');
  }
  assertSiteScope(actor, session.siteId);

  const config = siteConfigService.getSiteConfig(session.siteId);
  const site = await db.sites.get(session.siteId);
  const minutes = Math.max(1, Math.ceil((session.endedAt - session.startedAt) / 60_000));
  const subtotal = Number((minutes * config.ratePerMinute).toFixed(2));
  const total = subtotal;
  const dayKey = dateKey(session.endedAt);
  const todayOrders = await db.orders
    .where('siteId')
    .equals(session.siteId)
    .filter((order) => order.orderNumber.includes(dayKey))
    .count();
  const seq = String(todayOrders + 1).padStart(4, '0');
  const orderNumber = `CB-${site?.siteCode ?? 'SITE'}-${dayKey}-${seq}`;
  const operationId = `order-${sessionId}`;

  const idempotent = (await db.orders.toArray()).find((order) => order.operationId === operationId);
  if (idempotent) {
    return idempotent;
  }

  const encryptedNotes = encryptionKey
    ? await cryptoService.encryptField('', encryptionKey)
    : btoa('');

  const orderId = await db.orders.add({
    operationId,
    sessionId,
    siteId: session.siteId,
    createdAt: Date.now(),
    orderNumber,
    status: 'Draft',
    billingType: 'Standard',
    durationMinutes: minutes,
    ratePerMinute: config.ratePerMinute,
    subtotal,
    adjustmentAmount: 0,
    totalAmount: total,
    invoiceNotes: encryptedNotes,
    reconciliationStatus: 'Unreconciled',
    version: 1,
    ...(session.importBatchId !== undefined ? { importBatchId: session.importBatchId } : {}),
    ...(session.importRowId !== undefined ? { importRowId: session.importRowId } : {})
  });

  await auditService.log(actor, 'ORDER_GENERATED', 'Order', orderId, { sessionId, orderNumber });
  return (await db.orders.get(orderId)) as Order;
}

async function submitOrder(orderId: number, actor: User): Promise<void> {
  assertCanMutate(actor);
  const order = await db.orders.get(orderId);
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  assertSiteScope(actor, order.siteId);

  if (order.billingType === 'Compensation' && actor.role === 'Attendant') {
    throw new Error('ORDER_COMPENSATION_REQUIRES_APPROVAL');
  }

  const nextStatus = order.billingType === 'Standard' ? 'Approved' : 'Pending';
  await db.orders.update(orderId, { status: nextStatus, version: order.version + 1 });
  await auditService.log(actor, 'ORDER_SUBMITTED', 'Order', orderId, { status: nextStatus });
}

async function approveCompensation(orderId: number, actor: User): Promise<void> {
  assertApprover(actor);
  const order = await db.orders.get(orderId);
  if (!order || order.status !== 'Pending' || order.billingType !== 'Compensation') {
    throw new Error('ORDER_INVALID_STATE');
  }
  assertSiteScope(actor, order.siteId);

  await db.orders.update(orderId, {
    status: 'Approved',
    compensationApprovedBy: actor.id,
    version: order.version + 1
  });
  await notificationService.sendTemplateToSiteStaff(order.siteId, 'APPROVAL_OUTCOME', actor, {
    outcome: 'approved',
    orderNumber: order.orderNumber,
    approver: actor.username
  });
  await auditService.log(actor, 'COMPENSATION_APPROVED', 'Order', orderId);
}

async function rejectCompensation(orderId: number, note: string, actor: User): Promise<void> {
  assertApprover(actor);
  const order = await db.orders.get(orderId);
  if (!order || order.billingType !== 'Compensation') {
    throw new Error('ORDER_INVALID_STATE');
  }
  assertSiteScope(actor, order.siteId);

  await db.orders.update(orderId, {
    status: 'Draft',
    adjustmentReason: note,
    version: order.version + 1
  });
  await notificationService.sendTemplateToSiteStaff(order.siteId, 'APPROVAL_OUTCOME', actor, {
    outcome: 'rejected',
    orderNumber: order.orderNumber,
    approver: actor.username
  });
  await auditService.log(actor, 'COMPENSATION_REJECTED', 'Order', orderId, { note });
}

async function markPaid(orderId: number, actor: User): Promise<void> {
  assertCanMutate(actor);
  const order = await db.orders.get(orderId);
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  assertSiteScope(actor, order.siteId);

  const canPay =
    order.status === 'Approved' ||
    (order.status === 'Pending' && order.billingType === 'Standard');
  if (!canPay) {
    throw new Error('ORDER_INVALID_STATE');
  }

  await db.orders.update(orderId, { status: 'Paid', version: order.version + 1 });
  await auditService.log(actor, 'ORDER_PAID', 'Order', orderId);
}

async function refundOrder(orderId: number, reason: string, actor: User): Promise<void> {
  assertApprover(actor);
  if (reason.trim().length < 5) {
    throw new Error('ORDER_REFUND_REASON_REQUIRED');
  }
  const order = await db.orders.get(orderId);
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  assertSiteScope(actor, order.siteId);

  await db.orders.update(orderId, {
    status: 'Refunded',
    adjustmentReason: reason,
    version: order.version + 1
  });
  await notificationService.sendTemplateToSiteStaff(order.siteId, 'ORDER_REFUNDED', actor, {
    orderNumber: order.orderNumber,
    reason
  });
  await auditService.log(actor, 'ORDER_REFUNDED', 'Order', orderId, { reason });
}

async function setReconciliationStatus(
  orderId: number,
  status: 'Matched' | 'Discrepancy',
  actor: User
): Promise<void> {
  if (actor.role !== 'SystemAdministrator' && actor.role !== 'SiteManager') {
    throw new Error('RBAC_SCOPE_VIOLATION');
  }
  const order = await db.orders.get(orderId);
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  assertSiteScope(actor, order.siteId);

  await db.orders.update(orderId, { reconciliationStatus: status, version: order.version + 1 });
  await auditService.log(actor, 'ORDER_RECONCILIATION_UPDATED', 'Order', orderId, { status });
}

async function bulkMarkPaid(orderIds: number[], actor: User): Promise<void> {
  const userId = actor.id as number;
  rateLimiter.check(userId, 'bulk_order_mark_paid', 200, 60_000, orderIds.length);
  rateLimiter.record(userId, 'bulk_order_mark_paid', orderIds.length);

  for (const orderId of orderIds) {
    await markPaid(orderId, actor);
  }
}

export const orderService = {
  generateOrder,
  submitOrder,
  approveCompensation,
  rejectCompensation,
  markPaid,
  bulkMarkPaid,
  refundOrder,
  setReconciliationStatus
};
