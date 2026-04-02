export type UserRole = 'SystemAdministrator' | 'SiteManager' | 'Attendant' | 'Auditor';
export type NavMode = 'kiosk' | 'admin';

export interface User {
  id?: number;
  username: string;
  passwordHash: string;
  salt: string;
  role: UserRole;
  siteId?: number;
  failedAttempts: number;
  lockedUntil?: number;
}

export interface StoredSession {
  sessionId: number;
  userId: number;
  role: UserRole;
  siteId?: number;
}

export interface SessionAuth {
  id?: number;
  userId: number;
  createdAt: number;
  lastActiveAt: number;
}

export interface Site {
  id?: number;
  siteCode: string;
  name: string;
}

export interface Bay {
  id?: number;
  siteId: number;
  stationId: string;
  connectorId: string;
  label: string;
  status: 'Available' | 'Occupied' | 'Reserved' | 'Anomaly' | 'Offline';
}

export interface Reservation {
  id?: number;
  operationId: string;
  bayId: number;
  siteId: number;
  userId: number;
  customerName: string;
  customerPlate: string;
  scheduledStart: number;
  scheduledEnd: number;
  status: 'Scheduled' | 'CheckedIn' | 'Active' | 'Completed' | 'Cancelled' | 'NoShow';
  qrCode?: string;
  noShowDeadline: number;
  confirmedArrivalAt?: number;
  confirmedBy?: number;
  version: number;
  importBatchId?: number;
  importRowId?: number;
}

export interface ChargingSession {
  id?: number;
  reservationId: number;
  bayId: number;
  siteId: number;
  startedAt: number;
  endedAt?: number;
  status: 'Active' | 'TempLeave' | 'Anomaly' | 'Completed';
  heartbeatAt: number;
  tempLeaveCount: number;
  tempLeaveStartedAt?: number;
  anomalyReason?: string;
  version: number;
  importBatchId?: number;
  importRowId?: number;
}

export interface SiteConfig {
  siteId: number;
  tempLeaveMaxCount: number;
  tempLeaveMaxMinutes: number;
  anomalyHeartbeatTimeoutMin: number;
  noShowGraceMinutes: number;
  ratePerMinute: number;
}

export interface Order {
  id?: number;
  operationId: string;
  sessionId: number;
  siteId: number;
  createdAt?: number;
  orderNumber: string;
  status: 'Draft' | 'Pending' | 'Approved' | 'Paid' | 'Refunded' | 'Voided';
  billingType: 'Standard' | 'Compensation';
  durationMinutes: number;
  ratePerMinute: number;
  subtotal: number;
  adjustmentAmount: number;
  adjustmentReason?: string;
  totalAmount: number;
  invoiceNotes: string;
  reconciliationStatus: 'Unreconciled' | 'Matched' | 'Discrepancy';
  compensationApprovedBy?: number;
  version: number;
  importBatchId?: number;
  importRowId?: number;
}

export interface Notification {
  id?: number;
  recipientId: number;
  templateKey: NotificationTemplate;
  templateData: Record<string, string>;
  renderedSubject: string;
  renderedBody: string;
  status: 'Pending' | 'Delivered' | 'Failed' | 'Archived';
  isRead: boolean;
  lastAttemptAt?: number;
  failureReason?: string;
  createdAt: number;
  retries: number;
}

export type NotificationTemplate =
  | 'HOLD_AVAILABLE'
  | 'DUE_REMINDER'
  | 'OVERDUE_ALERT'
  | 'APPROVAL_OUTCOME'
  | 'NO_SHOW_CANCELLED'
  | 'OCCUPANCY_ANOMALY'
  | 'SESSION_COMPLETED'
  | 'ORDER_REFUNDED'
  | 'IMPORT_COMPLETE'
  | 'IMPORT_FAILED'
  | 'QUALITY_REPORT_READY';

export interface NotificationPrefs {
  userId: number;
  enabled: Record<NotificationTemplate, boolean>;
  showDesktopBanner: boolean;
}

export interface AuditLog {
  id?: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  siteId?: number;
  timestamp: number;
  chainHash: string;
  detail?: string;
}

export interface ImportBatch {
  id?: number;
  siteId: number;
  type?: 'reservations' | 'orders' | 'sessions';
  status: 'Validating' | 'Complete' | 'Failed';
  createdAt: number;
  dedupeHash: string;
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
  duplicateRows?: number;
  errorSummary?: string;
}

export interface ImportRow {
  id?: number;
  batchId: number;
  rowIndex: number;
  status: 'Valid' | 'Invalid' | 'Duplicate' | 'Imported';
  rawData: string;
  cleanedData: string;
  errorCode?: string;
}

export interface QualityReport {
  id?: number;
  siteId: number;
  generatedAt: number;
  type: 'Weekly';
  detail: string;
}

export interface ArchivedReservation {
  id?: number;
  originalId: number;
  archivedAt: number;
  siteId: number;
  bayId: number;
  operationId?: string;
  userId?: number;
  customerName?: string;
  customerPlate?: string;
  scheduledStart?: number;
  scheduledEnd?: number;
  status?: 'Scheduled' | 'CheckedIn' | 'Active' | 'Completed' | 'Cancelled' | 'NoShow';
  qrCode?: string;
  noShowDeadline?: number;
  confirmedArrivalAt?: number;
  confirmedBy?: number;
  version?: number;
  importBatchId?: number;
}

export interface ArchivedSession {
  id?: number;
  originalId: number;
  archivedAt: number;
  siteId: number;
  bayId: number;
  reservationId?: number;
  startedAt?: number;
  endedAt?: number;
  status?: 'Active' | 'TempLeave' | 'Anomaly' | 'Completed';
  heartbeatAt?: number;
  tempLeaveCount?: number;
  tempLeaveStartedAt?: number;
  anomalyReason?: string;
  version?: number;
  importBatchId?: number;
  importRowId?: number;
}

export interface ArchivedOrder {
  id?: number;
  originalId: number;
  archivedAt: number;
  siteId: number;
  operationId?: string;
  sessionId?: number;
  createdAt?: number;
  orderNumber?: string;
  status?: 'Draft' | 'Pending' | 'Approved' | 'Paid' | 'Refunded' | 'Voided';
  billingType?: 'Standard' | 'Compensation';
  durationMinutes?: number;
  ratePerMinute?: number;
  subtotal?: number;
  adjustmentAmount?: number;
  adjustmentReason?: string;
  totalAmount?: number;
  invoiceNotes?: string;
  reconciliationStatus?: 'Unreconciled' | 'Matched' | 'Discrepancy';
  compensationApprovedBy?: number;
  version?: number;
  importBatchId?: number;
  importRowId?: number;
}
