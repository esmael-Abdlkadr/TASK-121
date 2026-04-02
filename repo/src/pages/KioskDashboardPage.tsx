import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';

export default function KioskDashboardPage() {
  const { currentUser } = useAuth();
  const siteId = currentUser?.siteId ?? -1;

  const bays = useLiveQuery(
    () => db.bays.where('siteId').equals(siteId).toArray(),
    [siteId]
  );

  const reservations = useLiveQuery(
    () => db.reservations.where('siteId').equals(siteId).toArray(),
    [siteId]
  );

  const sessions = useLiveQuery(
    () => db.sessions_charging.where('siteId').equals(siteId).toArray(),
    [siteId]
  );

  const notifications = useLiveQuery(async () => {
    if (!currentUser) return [];
    return db.notifications
      .where('recipientId')
      .equals(currentUser.id as number)
      .filter((n) => !n.isRead && n.status !== 'Archived')
      .toArray();
  }, [currentUser]);

  if (!currentUser) {
    return null;
  }

  const allBays = bays ?? [];
  const occupiedCount = allBays.filter((b) => b.status === 'Occupied').length;
  const availableCount = allBays.filter((b) => b.status === 'Available').length;
  const reservedCount = allBays.filter((b) => b.status === 'Reserved').length;
  const anomalyBays = allBays.filter((b) => b.status === 'Anomaly');
  const offlineCount = allBays.filter((b) => b.status === 'Offline').length;

  const allReservations = reservations ?? [];
  const now = Date.now();
  const upcoming = allReservations
    .filter((r) => r.status === 'Scheduled' && r.scheduledStart > now)
    .sort((a, b) => a.scheduledStart - b.scheduledStart)
    .slice(0, 5);

  const noShows = allReservations.filter((r) => r.status === 'NoShow');
  const anomalySessions = (sessions ?? []).filter((s) => s.status === 'Anomaly');
  const activeSessions = (sessions ?? []).filter((s) => s.status === 'Active');
  const unreadCount = (notifications ?? []).length;

  return (
    <section className="card">
      <h1>Kiosk Dashboard</h1>

      <div className="bay-grid">
        <article className="bay-card">
          <h3>Bay Occupancy</h3>
          <p><strong>Total Bays:</strong> {allBays.length}</p>
          <p><strong>Available:</strong> {availableCount}</p>
          <p><strong>Occupied:</strong> {occupiedCount}</p>
          <p><strong>Reserved:</strong> {reservedCount}</p>
          {offlineCount > 0 && <p><strong>Offline:</strong> {offlineCount}</p>}
          {anomalyBays.length > 0 && <p className="error"><strong>Anomaly:</strong> {anomalyBays.length}</p>}
        </article>

        <article className="bay-card">
          <h3>Active Sessions</h3>
          <p><strong>Active:</strong> {activeSessions.length}</p>
          {anomalySessions.length > 0 ? (
            <p className="error"><strong>Anomaly Sessions:</strong> {anomalySessions.length}</p>
          ) : (
            <p className="muted">No anomalies</p>
          )}
        </article>

        <article className="bay-card">
          <h3>Alerts</h3>
          {noShows.length > 0 ? (
            <p className="error"><strong>No-Shows:</strong> {noShows.length}</p>
          ) : (
            <p className="muted">No recent no-shows</p>
          )}
          {unreadCount > 0 ? (
            <p><strong>Unread Notifications:</strong> {unreadCount}</p>
          ) : (
            <p className="muted">All caught up</p>
          )}
        </article>
      </div>

      {upcoming.length > 0 ? (
        <>
          <h2>Upcoming Reservations</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Bay</th>
                <th>Scheduled Start</th>
                <th>Starts In</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((r) => {
                const minUntil = Math.max(0, Math.ceil((r.scheduledStart - now) / 60_000));
                return (
                  <tr key={r.id}>
                    <td>{r.bayId}</td>
                    <td>{new Date(r.scheduledStart).toLocaleString()}</td>
                    <td>{minUntil} min</td>
                    <td>{r.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">No upcoming reservations.</p>
      )}

      {anomalyBays.length > 0 ? (
        <>
          <h2>Anomaly Bays</h2>
          <ul>
            {anomalyBays.map((b) => (
              <li key={b.id}>{b.label} ({b.stationId}/{b.connectorId})</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
