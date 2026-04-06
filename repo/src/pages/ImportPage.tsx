import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import FieldMapper from '../components/import/FieldMapper';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import { importService, type ImportType } from '../services/importService';
import { storageService } from '../services/storageService';

export default function ImportPage() {
  const { currentUser, encryptionKey } = useAuth();
  const isGlobal = currentUser?.role === 'SystemAdministrator';
  const sites = useLiveQuery(() => db.sites.toArray(), []);
  const [selectedSite, setSelectedSite] = useState<number>(() => {
    if (!isGlobal) return currentUser?.siteId ?? 1;
    return storageService.getLastSite() ?? 1;
  });
  const siteId = isGlobal ? selectedSite : (currentUser?.siteId as number);

  const [type, setType] = useState<ImportType>('reservations');
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<{
    totalRows: number;
    validRows: number;
    invalidRows: number;
    rows: Array<{ rowIndex: number; errorCode?: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const history = useLiveQuery(async () => {
    if (!currentUser) {
      return [];
    }
    if (isGlobal) {
      return db.importBatches
        .where('siteId')
        .equals(siteId)
        .reverse()
        .sortBy('createdAt');
    }
    return db.importBatches
      .where('siteId')
      .equals(siteId)
      .reverse()
      .sortBy('createdAt');
  }, [currentUser, siteId]);

  const requiredFields = useMemo(() => importService.REQUIRED_FIELDS[type], [type]);

  if (!currentUser) {
    return null;
  }

  const missingRequired = requiredFields.filter(
    (field) => !Object.values(fieldMap).includes(field)
  );

  return (
    <section className="card">
      <h1>Bulk Import</h1>

      {isGlobal && (
        <div className="filters-row">
          <label>
            Site:{' '}
            <select
              value={selectedSite}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSelectedSite(id);
                storageService.setLastSite(id);
                setFile(null);
                setHeaders([]);
                setFieldMap({});
                setSummary(null);
              }}
            >
              {(sites ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!encryptionKey && (type === 'reservations' || type === 'orders') ? (
        <p className="error">
          Encryption key not available. Please re-authenticate to unlock encrypted data before importing {type}.
        </p>
      ) : null}

      <h2>Step 1 - Template & Upload</h2>
      <div className="create-user-form">
        <select
          value={type}
          onChange={(event) => {
            const next = event.target.value as ImportType;
            setType(next);
            setFile(null);
            setHeaders([]);
            setFieldMap({});
            setSummary(null);
          }}
        >
          <option value="reservations">reservations</option>
          <option value="orders">orders</option>
          <option value="sessions">sessions</option>
        </select>
        <button className="button ghost" onClick={() => importService.downloadTemplate(type)}>
          Download Template
        </button>
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={async (event) => {
            const nextFile = event.target.files?.[0] ?? null;
            setFile(nextFile);
            setSummary(null);
            if (nextFile) {
              const preview = await importService.validateFile(
                nextFile,
                type,
                importService.autoMapFields([], type),
                currentUser,
                siteId
              );
              setHeaders(preview.headers);
              setFieldMap(importService.autoMapFields(preview.headers, type));
            }
          }}
        />
      </div>

      {headers.length > 0 ? (
        <>
          <h2>Step 2 - Field Mapping</h2>
          <FieldMapper
            headers={headers}
            requiredFields={requiredFields}
            fieldMap={fieldMap}
            onChange={setFieldMap}
          />
          {missingRequired.length > 0 ? (
            <p className="error">Missing required mappings: {missingRequired.join(', ')}</p>
          ) : null}
          <button
            className="button ghost"
            disabled={!file || missingRequired.length > 0}
            onClick={async () => {
              if (!file) {
                return;
              }
              const result = await importService.validateFile(file, type, fieldMap, currentUser, siteId);
              setSummary({
                totalRows: result.totalRows,
                validRows: result.validRows,
                invalidRows: result.invalidRows,
                rows: result.rows.map((row) => ({ rowIndex: row.rowIndex, errorCode: row.errorCode }))
              });
            }}
          >
            Validate
          </button>
        </>
      ) : null}

      {summary ? (
        <>
          <h2>Step 3 - Review & Import</h2>
          <p>
            Rows found: {summary.totalRows}, valid: {summary.validRows}, invalid: {summary.invalidRows}
          </p>
          {summary.invalidRows > 0 ? (
            <ul>
              {summary.rows
                .filter((row) => row.errorCode)
                .map((row) => (
                  <li key={row.rowIndex}>
                    Row {row.rowIndex}: {row.errorCode}
                  </li>
                ))}
            </ul>
          ) : null}
          <button
            className="button primary"
            disabled={!file || summary.invalidRows > 0 || missingRequired.length > 0 || busy || (!encryptionKey && (type === 'reservations' || type === 'orders'))}
            onClick={async () => {
              if (!file) {
                return;
              }
              setError(null);
              setBusy(true);
              try {
                await importService.startImport(file, type, fieldMap, currentUser, siteId, encryptionKey ?? undefined);
              } catch (importError) {
                if (importError instanceof Error) {
                  setError(importError.message);
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Importing...' : 'Start Import'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </>
      ) : null}

      <h2>Import History</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Status</th>
            <th>Rows</th>
            <th>Duplicates</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {(history ?? []).map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.createdAt).toLocaleString()}</td>
              <td>{row.type ?? '-'}</td>
              <td>{row.status}</td>
              <td>{row.totalRows ?? '-'}</td>
              <td>{row.duplicateRows ?? '-'}</td>
              <td>{row.errorSummary ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(history ?? []).length === 0 && <p className="muted">No import history yet.</p>}
    </section>
  );
}
