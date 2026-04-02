import { db } from '../db/db';
import type { QualityReport, User } from '../types';
import { auditService } from './auditService';
import { notificationService } from './notificationService';
import { assertManagerOrAdmin, assertSiteScope } from './rbacService';

interface TableStat {
  table: string;
  totalRows: number;
  missingFieldRows: number;
  completenessPct: number;
  duplicateRows: number;
}

interface ReportDetail {
  generatedAt: number;
  stats: TableStat[];
}

function completeness(total: number, missing: number): number {
  if (total === 0) {
    return 100;
  }
  return Number((((total - missing) / total) * 100).toFixed(2));
}

async function runReport(siteId: number, actor: User): Promise<QualityReport> {
  assertManagerOrAdmin(actor);
  assertSiteScope(actor, siteId);
  const reservations = await db.reservations.where('siteId').equals(siteId).toArray();
  const orders = await db.orders.where('siteId').equals(siteId).toArray();
  const sessions = await db.sessions_charging.where('siteId').equals(siteId).toArray();

  const reservationMissing = reservations.filter((r) => !r.customerName || !r.customerPlate).length;
  const orderMissing = orders.filter((o) => !o.orderNumber).length;
  const sessionMissing = sessions.filter((s) => !s.reservationId || !s.startedAt).length;

  const reservationKeyCount = new Map<string, number>();
  reservations.forEach((r) => {
    const key = `${r.bayId}_${r.scheduledStart}`;
    reservationKeyCount.set(key, (reservationKeyCount.get(key) ?? 0) + 1);
  });
  const reservationDuplicates = [...reservationKeyCount.values()].filter((count) => count > 1).length;

  const orderKeyCount = new Map<string, number>();
  orders.forEach((o) => {
    orderKeyCount.set(o.orderNumber, (orderKeyCount.get(o.orderNumber) ?? 0) + 1);
  });
  const orderDuplicates = [...orderKeyCount.values()].filter((count) => count > 1).length;

  const stats: TableStat[] = [
    {
      table: 'reservations',
      totalRows: reservations.length,
      missingFieldRows: reservationMissing,
      completenessPct: completeness(reservations.length, reservationMissing),
      duplicateRows: reservationDuplicates
    },
    {
      table: 'orders',
      totalRows: orders.length,
      missingFieldRows: orderMissing,
      completenessPct: completeness(orders.length, orderMissing),
      duplicateRows: orderDuplicates
    },
    {
      table: 'sessions_charging',
      totalRows: sessions.length,
      missingFieldRows: sessionMissing,
      completenessPct: completeness(sessions.length, sessionMissing),
      duplicateRows: 0
    }
  ];

  const detail: ReportDetail = {
    generatedAt: Date.now(),
    stats
  };

  const reportId = await db.qualityReports.add({
    siteId,
    generatedAt: detail.generatedAt,
    type: 'Weekly',
    detail: JSON.stringify(detail)
  });
  await auditService.log(actor, 'QUALITY_REPORT_GENERATED', 'QualityReport', reportId);

  const recipients = await db.users.where('siteId').equals(siteId).toArray();
  for (const user of recipients) {
    if (user.role === 'SiteManager') {
      await notificationService.send(user.id as number, 'QUALITY_REPORT_READY', {
        siteName: String(siteId),
        issues: String(stats.reduce((acc, row) => acc + row.missingFieldRows + row.duplicateRows, 0))
      });
    }
  }
  const sysAdmins = await db.users.where('role').equals('SystemAdministrator').toArray();
  for (const admin of sysAdmins) {
    await notificationService.send(admin.id as number, 'QUALITY_REPORT_READY', {
      siteName: String(siteId),
      issues: String(stats.reduce((acc, row) => acc + row.missingFieldRows + row.duplicateRows, 0))
    });
  }

  return (await db.qualityReports.get(reportId)) as QualityReport;
}

function exportReportCsv(report: QualityReport): void {
  const detail = JSON.parse(report.detail) as ReportDetail;
  const lines = [
    'table,completeness_pct,total_rows,missing_field_rows,duplicate_rows',
    ...detail.stats.map(
      (row) =>
        `${row.table},${row.completenessPct},${row.totalRows},${row.missingFieldRows},${row.duplicateRows}`
    )
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quality_report_${report.siteId}_${report.generatedAt}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function runWeeklyIfDue(siteId: number, actor: User): Promise<boolean> {
  const key = `cb_quality_lastRun_${siteId}`;
  const now = Date.now();
  const lastRun = Number(localStorage.getItem(key) ?? 0);
  if (now - lastRun <= 7 * 24 * 60 * 60 * 1000) {
    return false;
  }

  await runReport(siteId, actor);
  localStorage.setItem(key, String(now));
  return true;
}

export const qualityService = {
  runReport,
  exportReportCsv,
  runWeeklyIfDue
};
