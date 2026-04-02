export const DB_NAME = 'chargebayOfflineConsole';

export const HOT_AND_COLD_SCHEMA = {
  users: '++id, &username, role, siteId',
  sessions_auth: '++id, userId, createdAt, lastActiveAt',
  sites: '++id, &siteCode, name',
  bays: '++id, siteId, stationId, connectorId, status',
  reservations: '++id, bayId, siteId, userId, status, scheduledStart, &operationId',
  sessions_charging: '++id, reservationId, bayId, siteId, status, heartbeatAt, version',
  orders: '++id, sessionId, siteId, orderNumber, status, version',
  notifications: '++id, recipientId, templateKey, status, isRead, createdAt, retries',
  auditLogs: '++id, actor, action, entityType, entityId, siteId, timestamp',
  importBatches: '++id, siteId, status, createdAt, dedupeHash',
  importRows: '++id, batchId, rowIndex, status, rawData, cleanedData',
  qualityReports: '++id, siteId, generatedAt, type',
  reservations_cold: '++id, bayId, siteId, originalId, archivedAt',
  sessions_cold: '++id, bayId, siteId, originalId, archivedAt',
  orders_cold: '++id, siteId, originalId, archivedAt'
};
