import { db } from '../db/db';
import type {
  Notification,
  NotificationPrefs,
  NotificationTemplate,
  User
} from '../types';
import { auditService } from './auditService';
import { assertCanMutate } from './rbacService';

export const TEMPLATES: Record<
  NotificationTemplate,
  { subject: string; body: string }
> = {
  HOLD_AVAILABLE: {
    subject: 'Hold available',
    body: 'Bay {{bayLabel}} is now available for your reservation.'
  },
  DUE_REMINDER: {
    subject: 'Reservation due soon',
    body: 'Your reservation at {{bayLabel}} starts in 15 minutes ({{startTime}}).'
  },
  OVERDUE_ALERT: {
    subject: 'Reservation overdue',
    body: 'Reservation at {{bayLabel}} has not been checked in. Scheduled start was {{startTime}}.'
  },
  APPROVAL_OUTCOME: {
    subject: 'Compensation {{outcome}}',
    body: 'Your compensation request for Order {{orderNumber}} was {{outcome}} by {{approver}}.'
  },
  NO_SHOW_CANCELLED: {
    subject: 'Reservation auto-cancelled',
    body: 'Reservation {{reservationId}} was cancelled as no-show at {{time}}.'
  },
  OCCUPANCY_ANOMALY: {
    subject: 'Occupancy anomaly detected',
    body: 'Bay {{bayLabel}}: {{reason}}'
  },
  SESSION_COMPLETED: {
    subject: 'Session completed',
    body: 'Session at {{bayLabel}} completed. Duration: {{duration}} min. Order {{orderNumber}} generated.'
  },
  ORDER_REFUNDED: {
    subject: 'Order refunded',
    body: 'Order {{orderNumber}} has been refunded. Reason: {{reason}}'
  },
  IMPORT_COMPLETE: {
    subject: 'Import complete',
    body: '{{rowCount}} records imported successfully.'
  },
  IMPORT_FAILED: {
    subject: 'Import failed',
    body: 'Import batch {{batchId}} failed: {{reason}}'
  },
  QUALITY_REPORT_READY: {
    subject: 'Quality report ready',
    body: 'Data quality report for site {{siteName}} is ready. {{issues}} issues found.'
  }
};

const sentDueReminder = new Set<number>();
const sentOverdueAlert = new Set<number>();

function prefsKey(userId: number) {
  return `cb_notif_prefs_${userId}`;
}

function defaultPrefs(userId: number): NotificationPrefs {
  const enabled = Object.keys(TEMPLATES).reduce((acc, key) => {
    acc[key as NotificationTemplate] = true;
    return acc;
  }, {} as Record<NotificationTemplate, boolean>);

  return {
    userId,
    enabled,
    showDesktopBanner: true
  };
}

function getPrefs(userId: number): NotificationPrefs {
  const raw = localStorage.getItem(prefsKey(userId));
  if (!raw) {
    return defaultPrefs(userId);
  }

  try {
    const parsed = JSON.parse(raw) as NotificationPrefs;
    return {
      ...defaultPrefs(userId),
      ...parsed,
      enabled: {
        ...defaultPrefs(userId).enabled,
        ...parsed.enabled
      }
    };
  } catch {
    return defaultPrefs(userId);
  }
}

function savePrefs(prefs: NotificationPrefs): void {
  localStorage.setItem(prefsKey(prefs.userId), JSON.stringify(prefs));
}

function renderTemplate(source: string, data: Record<string, string>): string {
  return source.replace(/\{\{(.*?)\}\}/g, (_, key: string) => data[key.trim()] ?? '');
}

let bannerListener: ((subject: string, userId: number) => void) | null = null;

function setBannerListener(listener: ((subject: string, userId: number) => void) | null) {
  bannerListener = listener;
}

async function deliver(notificationId: number): Promise<void> {
  const notification = await db.notifications.get(notificationId);
  if (!notification || notification.status === 'Archived') {
    return;
  }

  try {
    const template = TEMPLATES[notification.templateKey];
    const renderedSubject = renderTemplate(template.subject, notification.templateData);
    const renderedBody = renderTemplate(template.body, notification.templateData);
    await db.notifications.update(notificationId, {
      status: 'Delivered',
      renderedSubject,
      renderedBody,
      lastAttemptAt: Date.now(),
      failureReason: undefined
    });

    const prefs = getPrefs(notification.recipientId);
    if (prefs.showDesktopBanner && bannerListener) {
      bannerListener(renderedSubject, notification.recipientId);
    }
  } catch (error) {
    const retries = notification.retries + 1;
    const message = error instanceof Error ? error.message : 'Delivery error';
    await db.notifications.update(notificationId, {
      retries,
      failureReason: message,
      lastAttemptAt: Date.now(),
      status: retries >= 3 ? 'Failed' : 'Pending'
    });

    if (retries < 3) {
      window.setTimeout(() => {
        void deliver(notificationId);
      }, 5_000);
    }
  }
}

async function send(
  recipientId: number,
  templateKey: NotificationTemplate,
  templateData: Record<string, string>
): Promise<Notification | null> {
  const prefs = getPrefs(recipientId);
  if (prefs.enabled[templateKey] === false) {
    return null;
  }

  const notification: Notification = {
    recipientId,
    templateKey,
    templateData,
    renderedSubject: '',
    renderedBody: '',
    status: 'Pending',
    isRead: false,
    retries: 0,
    createdAt: Date.now()
  };

  const id = await db.notifications.add(notification);
  await deliver(id);
  return (await db.notifications.get(id)) as Notification;
}

async function retryFailed(): Promise<void> {
  const rows = await db.notifications
    .where('status')
    .equals('Failed')
    .filter((item) => item.retries < 3)
    .toArray();
  for (const row of rows) {
    await deliver(row.id as number);
  }
}

async function markRead(notificationId: number, actor: User): Promise<void> {
  const row = await db.notifications.get(notificationId);
  if (!row) {
    return;
  }
  if (row.recipientId !== actor.id) {
    throw new Error('RBAC_SCOPE_VIOLATION');
  }
  await db.notifications.update(notificationId, { isRead: true });
}

async function archive(notificationId: number, actor: User): Promise<void> {
  const row = await db.notifications.get(notificationId);
  if (!row) {
    return;
  }
  if (actor.role === 'Auditor') {
    throw new Error('RBAC_SCOPE_VIOLATION');
  }
  if (row.recipientId !== actor.id && actor.role !== 'SystemAdministrator') {
    throw new Error('RBAC_SCOPE_VIOLATION');
  }
  await db.notifications.update(notificationId, { status: 'Archived' });
}

async function sendTemplateToSiteStaff(
  siteId: number,
  templateKey: NotificationTemplate,
  actor?: User,
  templateData: Record<string, string> = {}
): Promise<void> {
  const recipients = await db.users.where('siteId').equals(siteId).toArray();
  for (const user of recipients) {
    if (user.role === 'Attendant' || user.role === 'SiteManager') {
      await send(user.id as number, templateKey, templateData);
    }
  }

  if (actor) {
    await auditService.log(actor, 'NOTIFICATION_QUEUED', 'Notification', templateKey, {
      siteId
    });
  }
}

async function runDueAndOverdueSchedulers(actor: User): Promise<void> {
  assertCanMutate(actor);
  const now = Date.now();
  const reservations = await db.reservations
    .where('status')
    .equals('Scheduled')
    .filter((r) => (actor.role === 'SystemAdministrator' ? true : r.siteId === actor.siteId))
    .toArray();

  for (const reservation of reservations) {
    const dueMin = reservation.scheduledStart - now;
    if (dueMin >= 14 * 60_000 && dueMin <= 16 * 60_000 && !sentDueReminder.has(reservation.id as number)) {
      sentDueReminder.add(reservation.id as number);
      await sendTemplateToSiteStaff(reservation.siteId, 'DUE_REMINDER', actor, {
        bayLabel: String(reservation.bayId),
        startTime: new Date(reservation.scheduledStart).toLocaleTimeString()
      });
    }

    if (
      reservation.scheduledStart + 5 * 60_000 <= now &&
      !sentOverdueAlert.has(reservation.id as number)
    ) {
      sentOverdueAlert.add(reservation.id as number);
      await sendTemplateToSiteStaff(reservation.siteId, 'OVERDUE_ALERT', actor, {
        bayLabel: String(reservation.bayId),
        startTime: new Date(reservation.scheduledStart).toLocaleTimeString()
      });
    }
  }
}

function clearSchedulerState() {
  sentDueReminder.clear();
  sentOverdueAlert.clear();
}

async function getInbox(userId: number): Promise<Notification[]> {
  return db.notifications.where('recipientId').equals(userId).reverse().sortBy('createdAt');
}

async function getSendLog(actor: User): Promise<Notification[]> {
  if (actor.role === 'Attendant') {
    throw new Error('RBAC_SCOPE_VIOLATION');
  }

  if (actor.role === 'SystemAdministrator') {
    return db.notifications.orderBy('createdAt').reverse().toArray();
  }

  const siteUsers = await db.users.where('siteId').equals(actor.siteId as number).toArray();
  const ids = new Set(siteUsers.map((u) => u.id as number));
  const all = await db.notifications.orderBy('createdAt').reverse().toArray();
  return all.filter((n) => ids.has(n.recipientId));
}

async function manualRetry(notificationId: number, actor?: User): Promise<void> {
  if (actor && actor.role === 'Auditor') {
    throw new Error('RBAC_SCOPE_VIOLATION');
  }
  await deliver(notificationId);
}

export const notificationService = {
  TEMPLATES,
  getPrefs,
  savePrefs,
  setBannerListener,
  send,
  deliver,
  retryFailed,
  markRead,
  archive,
  sendTemplateToSiteStaff,
  runDueAndOverdueSchedulers,
  clearSchedulerState,
  getInbox,
  getSendLog,
  manualRetry
};
