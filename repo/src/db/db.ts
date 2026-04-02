import Dexie, { type Table } from 'dexie';
import { DB_NAME, HOT_AND_COLD_SCHEMA } from './schema';
import type {
  ArchivedOrder,
  ArchivedReservation,
  ArchivedSession,
  AuditLog,
  Bay,
  ChargingSession,
  ImportBatch,
  ImportRow,
  Notification,
  Order,
  QualityReport,
  Reservation,
  SessionAuth,
  Site,
  User
} from '../types';

class ChargeBayDb extends Dexie {
  users!: Table<User, number>;
  sessions_auth!: Table<SessionAuth, number>;
  sites!: Table<Site, number>;
  bays!: Table<Bay, number>;
  reservations!: Table<Reservation, number>;
  sessions_charging!: Table<ChargingSession, number>;
  orders!: Table<Order, number>;
  notifications!: Table<Notification, number>;
  auditLogs!: Table<AuditLog, number>;
  importBatches!: Table<ImportBatch, number>;
  importRows!: Table<ImportRow, number>;
  qualityReports!: Table<QualityReport, number>;
  reservations_cold!: Table<ArchivedReservation, number>;
  sessions_cold!: Table<ArchivedSession, number>;
  orders_cold!: Table<ArchivedOrder, number>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores(HOT_AND_COLD_SCHEMA);
  }
}

export const db = new ChargeBayDb();
