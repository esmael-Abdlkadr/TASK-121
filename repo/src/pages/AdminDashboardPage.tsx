import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import { exportService } from '../services/exportService';
import { storageService } from '../services/storageService';
import { tieringService } from '../services/tieringService';

export default function AdminDashboardPage() {
  const { currentUser } = useAuth();
  const sites = useLiveQuery(() => db.sites.toArray(), []);
  const isGlobal = currentUser?.role === 'SystemAdministrator';
  const [selectedSite, setSelectedSite] = useState<number>(() => {
    if (!isGlobal) return currentUser?.siteId ?? 1;
    return storageService.getLastSite() ?? 1;
  });
  const siteId = isGlobal ? selectedSite : (currentUser?.siteId ?? 1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [password, setPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lastTiering = useMemo(() => {
    const raw = localStorage.getItem(`cb_tiering_last_${siteId}`);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as {
      ranAt: number;
      reservationsArchived: number;
      sessionsArchived: number;
      ordersArchived: number;
    };
  }, [siteId, message]);

  if (!currentUser) {
    return null;
  }

  const isReadOnly = currentUser.role === 'Auditor';

  return (
    <section className="card">
      <h1>Admin Dashboard</h1>
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
              }}
            >
              {(sites ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {isReadOnly ? (
        <article className="card">
          <h2>Archive Status (Read-Only)</h2>
          {lastTiering ? (
            <p>
              Last archiving run: {new Date(lastTiering.ranAt).toLocaleString()} | reservations:{' '}
              {lastTiering.reservationsArchived}, sessions: {lastTiering.sessionsArchived}, orders:{' '}
              {lastTiering.ordersArchived}
            </p>
          ) : (
            <p>No archiving runs recorded yet.</p>
          )}
          <p className="muted">Auditor access is read-only. Export, import, and archiving actions are not available.</p>
        </article>
      ) : (
        <article className="card">
          <h2>Export & Archive</h2>
          <div className="create-user-form">
            <label>
              From
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <input
              type="password"
              placeholder="Export password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              className="button ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await exportService.exportPackage(
                    siteId,
                    {
                      from: new Date(from).getTime(),
                      to: new Date(to).getTime()
                    },
                    password,
                    currentUser
                  );
                  setMessage('Export package created.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Exporting...' : 'Export Package'}
            </button>

            <input type="file" accept=".json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <input
              type="password"
              placeholder="Import password"
              value={importPassword}
              onChange={(event) => setImportPassword(event.target.value)}
            />
            <button
              className="button ghost"
              disabled={busy}
              onClick={async () => {
                if (!file) {
                  return;
                }
                setBusy(true);
                try {
                  const result = await exportService.importPackage(file, importPassword, currentUser);
                  setMessage(`Import applied. Inserted ${result.inserted}, skipped ${result.skipped}.`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Importing...' : 'Import Package'}
            </button>

            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await tieringService.runTiering(siteId, currentUser);
                  setMessage(
                    `Tiering complete: ${result.reservationsArchived} reservations, ${result.sessionsArchived} sessions, ${result.ordersArchived} orders.`
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Archiving...' : 'Run Archiving Now'}
            </button>
          </div>

          {lastTiering ? (
            <p>
              Last archiving run: {new Date(lastTiering.ranAt).toLocaleString()} | reservations:{' '}
              {lastTiering.reservationsArchived}, sessions: {lastTiering.sessionsArchived}, orders:{' '}
              {lastTiering.ordersArchived}
            </p>
          ) : null}
          {message ? <p>{message}</p> : null}
        </article>
      )}
    </section>
  );
}
