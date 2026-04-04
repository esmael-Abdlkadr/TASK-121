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
  SiteConfig,
  User
} from '../types';

export interface RateLimitRecord {
  key: string;
  count: number;
  windowStart: number;
}

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
  siteConfigs!: Table<SiteConfig & { id: number }, number>;
  rateLimits!: Table<RateLimitRecord, string>;

  constructor() {
    super(DB_NAME);

    const V1_SCHEMA = { ...HOT_AND_COLD_SCHEMA };
    delete (V1_SCHEMA as Record<string, string>).siteConfigs;
    delete (V1_SCHEMA as Record<string, string>).rateLimits;
    this.version(1).stores(V1_SCHEMA);

    this.version(2).stores(HOT_AND_COLD_SCHEMA).upgrade(async (tx) => {
      const siteConfigs = tx.table('siteConfigs');
      const sites = tx.table('sites');
      const allSites = await sites.toArray();
      for (const site of allSites) {
        const key = `cb_site_config_${site.id}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            await siteConfigs.put({ ...parsed, id: site.id, siteId: site.id });
          } catch { /* skip unparsable */ }
        }
      }
    });
  }
}

export const db = new ChargeBayDb();
