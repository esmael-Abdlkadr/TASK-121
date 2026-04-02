import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import { auditService } from '../services/auditService';

export default function AuditLogPage() {
  const { currentUser } = useAuth();
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const logs = useLiveQuery(async () => {
    if (!currentUser) {
      return [];
    }

    const rows =
      currentUser.role === 'SystemAdministrator'
        ? await db.auditLogs.orderBy('timestamp').reverse().toArray()
        : await db.auditLogs
            .where('siteId')
            .equals(currentUser.siteId as number)
            .reverse()
            .sortBy('timestamp');
    return rows;
  }, [currentUser]);

  const filtered = useMemo(
    () =>
      (logs ?? []).filter(
        (row) =>
          (actorFilter ? row.actor.toLowerCase().includes(actorFilter.toLowerCase()) : true) &&
          (actionFilter ? row.action.toLowerCase().includes(actionFilter.toLowerCase()) : true) &&
          (entityFilter ? row.entityType.toLowerCase().includes(entityFilter.toLowerCase()) : true)
      ),
    [actorFilter, actionFilter, entityFilter, logs]
  );

  if (!currentUser) {
    return null;
  }

  return (
    <section className="card">
      <h1>Audit Log</h1>
      <div className="filters-row">
        <input placeholder="Actor" value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} />
        <input placeholder="Action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} />
        <input
          placeholder="Entity Type"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
        />
        <button
          className="button ghost"
          disabled={isVerifying}
          onClick={async () => {
            setIsVerifying(true);
            const result = await auditService.verifyChainDetails(
              currentUser.role === 'SystemAdministrator' ? undefined : (currentUser.siteId as number)
            );
            setIsVerifying(false);
            setVerifyMessage(
              result.valid
                ? `✓ Audit chain verified — no tampering detected (${result.total} entries, ${result.from ? new Date(result.from).toLocaleString() : '-'} to ${result.to ? new Date(result.to).toLocaleString() : '-'})`
                : `✗ Chain integrity check FAILED — possible tampering detected (${result.total} entries)`
            );
          }}
        >
          {isVerifying ? 'Verifying...' : 'Verify Chain Integrity'}
        </button>
        <button className="button ghost" onClick={() => auditService.exportCsv(filtered)}>
          Export Audit Log
        </button>
      </div>

      {verifyMessage ? (
        <p className={verifyMessage.startsWith('✓') ? 'success-banner' : 'error'}>{verifyMessage}</p>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Entity Type</th>
            <th>Entity ID</th>
            <th>Site</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.timestamp).toLocaleString()}</td>
              <td>{row.actor}</td>
              <td>{row.action}</td>
              <td>{row.entityType}</td>
              <td>{row.entityId}</td>
              <td>{row.siteId ?? '-'}</td>
              <td>
                <details>
                  <summary>View</summary>
                  <pre>{row.detail ?? '{}'}</pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && <p className="muted">No audit log entries match the current filters.</p>}
    </section>
  );
}
