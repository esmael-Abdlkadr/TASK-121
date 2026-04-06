import * as XLSX from 'xlsx';
import { db } from '../db/db';
import type { ImportBatch, ImportRow, User } from '../types';
import { auditService } from './auditService';
import { cryptoService } from './cryptoService';
import { notificationService } from './notificationService';
import { assertManagerOrAdmin, assertSiteScope } from './rbacService';
import { siteConfigService } from './siteConfigService';

export type ImportType = 'reservations' | 'orders' | 'sessions';
export type FieldMap = Record<string, string>;

const REQUIRED_FIELDS: Record<ImportType, string[]> = {
  reservations: [
    'stationId',
    'connectorId',
    'customerName',
    'customerPlate',
    'scheduledStart',
    'scheduledEnd'
  ],
  orders: [
    'orderNumber',
    'sessionId',
    'durationMinutes',
    'ratePerMinute',
    'adjustmentAmount',
    'adjustmentReason',
    'invoiceNotes'
  ],
  sessions: ['reservationId', 'startedAt']
};

const TEMPLATE_ROWS: Record<ImportType, { headers: string[]; sample: string[] }> = {
  reservations: {
    headers: [
      'stationId',
      'connectorId',
      'customerName',
      'customerPlate',
      'scheduledStart',
      'scheduledEnd'
    ],
    sample: ['ST-01', 'C1', 'Alex Doe', 'ABC123', '04/01/2026 09:30', '04/01/2026 11:00']
  },
  orders: {
    headers: [
      'orderNumber',
      'sessionId',
      'durationMinutes',
      'ratePerMinute',
      'adjustmentAmount',
      'adjustmentReason',
      'invoiceNotes'
    ],
    sample: ['CB-SITE-001-20260401-0001', '100', '90', '0.5', '0', '', 'Imported invoice note']
  },
  sessions: {
    headers: ['reservationId', 'startedAt'],
    sample: ['100', '04/01/2026 09:30']
  }
};

/**
 * RFC 4180-oriented parser for the import workflows.
 * Handles quoted fields, embedded commas, doubled-quote escapes (""),
 * and embedded newlines inside quoted cells.
 */
function parseCsv(csv: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const ch = csv[index];

    if (inQuotes) {
      if (ch === '"') {
        if (csv[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((entry) => entry.length > 0)) {
        records.push(row);
      }
      row = [];
      cell = '';
      continue;
    }

    if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((entry) => entry.length > 0)) {
    records.push(row);
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...dataRows] = records;
  const rows = dataRows.map((cells) => {
    const parsedRow: Record<string, string> = {};
    headers.forEach((header, index) => {
      parsedRow[header] = (cells[index] ?? '').trim();
    });
    return parsedRow;
  });

  return { headers, rows };
}

export function parseDate(value: string): number | null {
  // Full datetime format: MM/DD/YYYY HH:mm
  const fullMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s(\d{2}):(\d{2})$/);
  if (fullMatch) {
    const [, mm, dd, yyyy, hh, min] = fullMatch;
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Number(yyyy), month - 1, day, Number(hh), Number(min));
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  // Date-only format: MM/DD/YYYY — defaults to 00:00 local time
  const dateMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dateMatch) {
    const [, mm, dd, yyyy] = dateMatch;
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Number(yyyy), month - 1, day, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  return null;
}

async function sha256(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function parseFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[]; raw: string }> {
  const readAsText =
    'text' in file
      ? async () => (await (file as unknown as { text: () => Promise<string> }).text())
      : async () =>
          await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
          });

  const readAsArrayBuffer =
    'arrayBuffer' in file
      ? async () =>
          await (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer()
      : async () =>
          await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
          });

  if (file.name.toLowerCase().endsWith('.xlsx')) {
    const bytes = await readAsArrayBuffer();
    const workbook = XLSX.read(bytes, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    const [headersRow = [], ...body] = matrix;
    const headers = headersRow.map((cell) => String(cell).trim());
    const rows = body.map((cells) => {
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = String(cells[index] ?? '').trim();
      });
      return row;
    });
    return { headers, rows, raw: JSON.stringify(matrix) };
  }

  const text = await readAsText();
  const parsed = parseCsv(text);
  return { ...parsed, raw: text };
}

function applyFieldMap(row: Record<string, string>, fieldMap: FieldMap): Record<string, string> {
  const mapped: Record<string, string> = {};
  Object.entries(fieldMap).forEach(([source, target]) => {
    if (target) {
      mapped[target] = row[source] ?? '';
    }
  });
  return mapped;
}

async function validateRows(
  rows: Record<string, string>[],
  type: ImportType,
  targetSiteId: number
): Promise<{ importRows: ImportRow[]; invalidCount: number; validCount: number }> {
  const output: ImportRow[] = [];
  let invalidCount = 0;
  let validCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    let errorCode: string | undefined;

    for (const field of REQUIRED_FIELDS[type]) {
      if (!row[field]) {
        errorCode = 'IMPORT_REQUIRED_FIELD_MISSING';
      }
    }

    if (!errorCode && type === 'reservations') {
      const start = parseDate(row.scheduledStart);
      const end = parseDate(row.scheduledEnd);
      if (!start || !end) {
        errorCode = 'IMPORT_DATE_FORMAT_INVALID';
      } else if (start >= end) {
        errorCode = 'IMPORT_DATE_RANGE_INVALID';
      } else {
        const bay = await db.bays
          .where('siteId')
          .equals(targetSiteId)
          .filter((b) => b.stationId === row.stationId && b.connectorId === row.connectorId)
          .first();
        if (!bay) {
          errorCode = 'IMPORT_BAY_NOT_FOUND';
        }
      }
    }

    if (!errorCode && type === 'orders') {
      const duration = Number(row.durationMinutes);
      const rate = Number(row.ratePerMinute);
      const adjustment = Number(row.adjustmentAmount);
      // Pricing bounds per prompt spec: price must be $0.01–$9,999.99
      const RATE_MIN = 0.01;
      const RATE_MAX = 9999.99;
      if (!(duration > 0)) {
        errorCode = 'IMPORT_DURATION_INVALID';
      } else if (!(rate >= RATE_MIN) || !(rate <= RATE_MAX) || Number(rate.toFixed(2)) !== rate) {
        errorCode = 'IMPORT_RATE_OUT_OF_BOUNDS';
      } else if (Number.isNaN(adjustment)) {
        errorCode = 'IMPORT_ADJUSTMENT_INVALID';
      }
    }

    output.push({
      batchId: 0,
      rowIndex: index + 1,
      status: errorCode ? 'Invalid' : 'Valid',
      rawData: JSON.stringify(rows[index]),
      cleanedData: JSON.stringify(row),
      errorCode
    });

    if (errorCode) {
      invalidCount += 1;
    } else {
      validCount += 1;
    }
  }

  return { importRows: output, invalidCount, validCount };
}

function autoMapFields(headers: string[], type: ImportType): FieldMap {
  const required = REQUIRED_FIELDS[type];
  const lowerMap = new Map(required.map((field) => [field.toLowerCase(), field]));
  const map: FieldMap = {};
  headers.forEach((header) => {
    const target = lowerMap.get(header.toLowerCase());
    map[header] = target ?? '';
  });
  return map;
}

function generateCsv(rows: string[][]): string {
  return rows.map((line) => line.join(',')).join('\n');
}

function downloadTemplate(type: ImportType): void {
  const def = TEMPLATE_ROWS[type];
  const csv = generateCsv([def.headers, def.sample]);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}_template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function validateFile(
  file: File,
  type: ImportType,
  fieldMap: FieldMap,
  actor: User,
  targetSiteId: number
): Promise<{ totalRows: number; validRows: number; invalidRows: number; rows: ImportRow[]; headers: string[] }> {
  assertManagerOrAdmin(actor);
  assertSiteScope(actor, targetSiteId);
  const parsed = await parseFile(file);
  const mappedRows = parsed.rows.map((row) => applyFieldMap(row, fieldMap));
  const validated = await validateRows(mappedRows, type, targetSiteId);
  return {
    totalRows: mappedRows.length,
    validRows: validated.validCount,
    invalidRows: validated.invalidCount,
    rows: validated.importRows,
    headers: parsed.headers
  };
}

async function startImport(
  file: File,
  type: ImportType,
  fieldMap: FieldMap,
  actor: User,
  targetSiteId: number,
  encryptionKey?: CryptoKey
): Promise<ImportBatch> {
  assertManagerOrAdmin(actor);
  assertSiteScope(actor, targetSiteId);

  if (type !== 'sessions' && !encryptionKey) {
    throw new Error('IMPORT_ENCRYPTION_KEY_REQUIRED');
  }

  const parsed = await parseFile(file);
  const dedupeHash = await sha256(parsed.raw);

  const existingBatch = await db.importBatches
    .where('siteId')
    .equals(targetSiteId)
    .filter((b) => b.dedupeHash === dedupeHash)
    .first();
  if (existingBatch) {
    throw new Error('IMPORT_DUPLICATE_FILE');
  }

  const batchId = await db.importBatches.add({
    siteId: targetSiteId,
    type,
    status: 'Validating',
    createdAt: Date.now(),
    dedupeHash
  });

  const mappedRows = parsed.rows.map((row) => applyFieldMap(row, fieldMap));
  const validation = await validateRows(mappedRows, type, targetSiteId);
  const validationRows = validation.importRows.map((row) => ({ ...row, batchId }));
  await db.importRows.bulkAdd(validationRows);

  if (validation.invalidCount > 0) {
    await db.importBatches.update(batchId, {
      status: 'Failed',
      totalRows: mappedRows.length,
      validRows: validation.validCount,
      invalidRows: validation.invalidCount,
      duplicateRows: 0,
      errorSummary: `${validation.invalidCount} invalid rows`
    });
    await notificationService.send(actor.id as number, 'IMPORT_FAILED', {
      batchId: String(batchId),
      reason: `${validation.invalidCount} validation errors`
    });
    return (await db.importBatches.get(batchId)) as ImportBatch;
  }

  // Pre-encrypt sensitive fields outside the Dexie transaction
  // (WebCrypto operations break IndexedDB transaction scope)
  const encryptedRows: Array<{ encName?: string; encPlate?: string; encNotes?: string }> = [];
  if (type === 'reservations' || type === 'orders') {
    for (const row of mappedRows) {
      if (type === 'reservations') {
        encryptedRows.push({
          encName: await cryptoService.encryptField(row.customerName, encryptionKey!),
          encPlate: await cryptoService.encryptField(row.customerPlate, encryptionKey!)
        });
      } else {
        encryptedRows.push({
          encNotes: await cryptoService.encryptField(row.invoiceNotes, encryptionKey!)
        });
      }
    }
  }

  let duplicateRows = 0;
  await db.transaction(
    'rw',
    db.reservations,
    db.orders,
    db.sessions_charging,
    db.bays,
    db.importRows,
    async () => {
      for (let index = 0; index < mappedRows.length; index += 1) {
        const row = mappedRows[index];
        let isDuplicate = false;

        if (type === 'reservations') {
          const start = parseDate(row.scheduledStart) as number;
          const bay = await db.bays
            .where('siteId')
            .equals(targetSiteId)
            .filter((b) => b.stationId === row.stationId && b.connectorId === row.connectorId)
            .first();

          const dup = await db.reservations
            .where('siteId')
            .equals(targetSiteId)
            .filter((r) => r.bayId === bay?.id && r.scheduledStart === start)
            .first();
          if (dup) {
            isDuplicate = true;
          } else {
            const encName = encryptedRows[index]!.encName!;
            const encPlate = encryptedRows[index]!.encPlate!;
            await db.reservations.add({
              operationId: crypto.randomUUID(),
              bayId: bay?.id as number,
              siteId: targetSiteId,
              userId: actor.id as number,
              customerName: encName,
              customerPlate: encPlate,
              scheduledStart: start,
              scheduledEnd: parseDate(row.scheduledEnd) as number,
              status: 'Scheduled',
              noShowDeadline: start + siteConfigService.getSiteConfig(targetSiteId).noShowGraceMinutes * 60_000,
              version: 1,
              importBatchId: batchId,
              importRowId: index + 1
            });
          }
        }

        if (type === 'orders') {
          const dup = await db.orders
            .where('siteId')
            .equals(targetSiteId)
            .filter((o) => o.orderNumber === row.orderNumber)
            .first();
          if (dup) {
            isDuplicate = true;
          } else {
            const duration = Number(row.durationMinutes);
            const rate = Number(row.ratePerMinute);
            const adjustment = Number(row.adjustmentAmount);
            const subtotal = Number((duration * rate).toFixed(2));
            const encNotes = encryptedRows[index]!.encNotes!;
            await db.orders.add({
              operationId: crypto.randomUUID(),
              sessionId: Number(row.sessionId),
              siteId: targetSiteId,
              orderNumber: row.orderNumber,
              status: 'Draft',
              billingType: 'Standard',
              durationMinutes: duration,
              ratePerMinute: rate,
              subtotal,
              adjustmentAmount: adjustment,
              adjustmentReason: row.adjustmentReason,
              totalAmount: Number((subtotal + adjustment).toFixed(2)),
              invoiceNotes: encNotes,
              reconciliationStatus: 'Unreconciled',
              version: 1,
              importBatchId: batchId,
              importRowId: index + 1
            });
          }
        }

        if (type === 'sessions') {
          const startedAt = parseDate(row.startedAt);
          const dup = await db.sessions_charging
            .where('reservationId')
            .equals(Number(row.reservationId))
            .filter((s) => s.startedAt === startedAt)
            .first();
          if (dup) {
            isDuplicate = true;
          } else {
            const reservation = await db.reservations.get(Number(row.reservationId));
            if (reservation) {
              await db.sessions_charging.add({
                reservationId: reservation.id as number,
                bayId: reservation.bayId,
                siteId: reservation.siteId,
                startedAt: startedAt as number,
                status: 'Active',
                heartbeatAt: startedAt as number,
                tempLeaveCount: 0,
                version: 1,
                importBatchId: batchId,
                importRowId: index + 1
              });
            }
          }
        }

        if (isDuplicate) {
          duplicateRows += 1;
          const row = await db.importRows
            .where('batchId')
            .equals(batchId)
            .filter((item) => item.rowIndex === index + 1)
            .first();
          if (row?.id) {
            await db.importRows.update(row.id, { status: 'Duplicate' });
          }
        } else {
          const row = await db.importRows
            .where('batchId')
            .equals(batchId)
            .filter((item) => item.rowIndex === index + 1)
            .first();
          if (row?.id) {
            await db.importRows.update(row.id, { status: 'Imported' });
          }
        }
      }
    }
  );

  await db.importBatches.update(batchId, {
    status: 'Complete',
    totalRows: mappedRows.length,
    validRows: validation.validCount,
    invalidRows: validation.invalidCount,
    duplicateRows
  });

  await notificationService.send(actor.id as number, 'IMPORT_COMPLETE', {
    rowCount: String(mappedRows.length - duplicateRows)
  });
  await auditService.log(actor, 'IMPORT_COMPLETED', 'ImportBatch', batchId, {
    type,
    totalRows: mappedRows.length,
    duplicateRows
  });

  return (await db.importBatches.get(batchId)) as ImportBatch;
}

export const importService = {
  REQUIRED_FIELDS,
  autoMapFields,
  downloadTemplate,
  validateFile,
  startImport
};
