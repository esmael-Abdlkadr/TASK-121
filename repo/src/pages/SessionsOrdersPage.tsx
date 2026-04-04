import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import CompensationModal from '../components/CompensationModal';
import ExceptionModal from '../components/ExceptionModal';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import ForbiddenPage from './ForbiddenPage';
import { orderService } from '../services/orderService';
import { reservationService } from '../services/reservationService';
import { sessionService } from '../services/sessionService';
import type { ChargingSession, Order } from '../types';

type Tab = 'sessions' | 'orders';

function minutesSince(ts: number) {
  return Math.max(0, Math.floor((Date.now() - ts) / 60_000));
}

export default function SessionsOrdersPage() {
  const { currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>('sessions');
  const [sessionFilter, setSessionFilter] = useState('All');
  const [orderFilter, setOrderFilter] = useState('All');
  const [reconFilter, setReconFilter] = useState('All');
  const [showForbidden, setShowForbidden] = useState(false);
  const [exceptionSession, setExceptionSession] = useState<ChargingSession | null>(null);
  const [compOrder, setCompOrder] = useState<Order | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const isReadOnly = currentUser?.role === 'Auditor';
  const isManagerOrAdmin =
    currentUser?.role === 'SystemAdministrator' || currentUser?.role === 'SiteManager';

  const sessions = useLiveQuery(
    async () => {
      if (!currentUser) return [];
      if (currentUser.role === 'SystemAdministrator') {
        return db.sessions_charging.orderBy('id').reverse().toArray();
      }
      return db.sessions_charging.where('siteId').equals(currentUser.siteId!).toArray();
    },
    [currentUser]
  );

  const orders = useLiveQuery(
    async () => {
      if (!currentUser) return [];
      if (currentUser.role === 'SystemAdministrator') {
        return db.orders.orderBy('id').reverse().toArray();
      }
      return db.orders.where('siteId').equals(currentUser.siteId!).toArray();
    },
    [currentUser]
  );

  const visibleSessions = useMemo(() => {
    const all = sessions ?? [];
    return all.filter((session) => (sessionFilter === 'All' ? true : session.status === sessionFilter));
  }, [sessions, sessionFilter]);

  const visibleOrders = useMemo(() => {
    const all = orders ?? [];
    return all.filter(
      (order) =>
        (orderFilter === 'All' ? true : order.status === orderFilter) &&
        (reconFilter === 'All' ? true : order.reconciliationStatus === reconFilter)
    );
  }, [orders, orderFilter, reconFilter]);

  if (!currentUser) {
    return null;
  }

  if (showForbidden) {
    return <ForbiddenPage />;
  }

  return (
    <section className="card">
      <div className="page-header">
        <h1>Sessions & Orders Workspace</h1>
        <div className="tab-row">
          <button className={`button ${tab === 'sessions' ? 'primary' : 'ghost'}`} onClick={() => setTab('sessions')}>
            Sessions
          </button>
          <button className={`button ${tab === 'orders' ? 'primary' : 'ghost'}`} onClick={() => setTab('orders')}>
            Orders
          </button>
        </div>
      </div>

      {tab === 'sessions' ? (
        <>
          <div className="filters-row">
            <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
              <option value="All">All statuses</option>
              <option value="Active">Active</option>
              <option value="TempLeave">TempLeave</option>
              <option value="Anomaly">Anomaly</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Bay</th>
                <th>Start Time</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Temp Leaves</th>
                <th>Heartbeat Age</th>
                {!isReadOnly && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleSessions.map((session) => (
                <tr key={session.id}>
                  <td>{session.bayId}</td>
                  <td>{new Date(session.startedAt).toLocaleString()}</td>
                  <td>{minutesSince(session.startedAt)} min</td>
                  <td>{session.status}</td>
                  <td>{session.tempLeaveCount}</td>
                  <td>{minutesSince(session.heartbeatAt)} min</td>
                  {!isReadOnly && (
                    <td>
                      <div className="inline-actions">
                        {session.status === 'Active' ? (
                          <button
                            className="button ghost"
                            type="button"
                            disabled={busyAction !== null}
                            onClick={async () => {
                              setBusyAction(`complete-${session.id}`);
                              try { await sessionService.completeSession(session.id as number, currentUser); } finally { setBusyAction(null); }
                            }}
                          >
                            {busyAction === `complete-${session.id}` ? 'Completing...' : 'Complete Session'}
                          </button>
                        ) : null}
                        {session.status === 'Active' || session.status === 'TempLeave' ? (
                          <button
                            className="button ghost"
                            type="button"
                            disabled={busyAction !== null}
                            onClick={async () => {
                              setBusyAction(`anomaly-${session.id}`);
                              try { await reservationService.flagAnomaly(session.id as number, 'Manual exception flag', currentUser); } finally { setBusyAction(null); }
                            }}
                          >
                            Flag Anomaly
                          </button>
                        ) : null}
                        {session.status === 'TempLeave' ? (
                          <button
                            className="button ghost"
                            type="button"
                            disabled={busyAction !== null}
                            onClick={async () => {
                              setBusyAction(`endleave-${session.id}`);
                              try { await reservationService.endTempLeave(session.id as number, currentUser); } finally { setBusyAction(null); }
                            }}
                          >
                            End Temp Leave
                          </button>
                        ) : null}
                        {session.status === 'Anomaly' && isManagerOrAdmin ? (
                          <button
                            className="button ghost"
                            type="button"
                            onClick={() => setExceptionSession(session)}
                          >
                            Resolve
                          </button>
                        ) : null}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {visibleSessions.length === 0 && <p className="muted">No sessions match the selected filter.</p>}
        </>
      ) : (
        <>
          <div className="filters-row">
            <select value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)}>
              <option value="All">All statuses</option>
              <option value="Draft">Draft</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Paid">Paid</option>
              <option value="Refunded">Refunded</option>
            </select>
            <select value={reconFilter} onChange={(event) => setReconFilter(event.target.value)}>
              <option value="All">All reconciliation</option>
              <option value="Unreconciled">Unreconciled</option>
              <option value="Matched">Matched</option>
              <option value="Discrepancy">Discrepancy</option>
            </select>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Session</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Reconciliation</th>
                <th>Billing Type</th>
                {!isReadOnly && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((order) => (
                <tr key={order.id}>
                  <td>{order.orderNumber}</td>
                  <td>{order.sessionId}</td>
                  <td>${order.totalAmount.toFixed(2)}</td>
                  <td>{order.status}</td>
                  <td>
                    {isManagerOrAdmin ? (
                      <select
                        value={order.reconciliationStatus}
                        onChange={async (event) => {
                          try {
                            await orderService.setReconciliationStatus(
                              order.id as number,
                              event.target.value as 'Matched' | 'Discrepancy',
                              currentUser
                            );
                          } catch {
                            setShowForbidden(true);
                          }
                        }}
                      >
                        <option value="Unreconciled">Unreconciled</option>
                        <option value="Matched">Matched</option>
                        <option value="Discrepancy">Discrepancy</option>
                      </select>
                    ) : (
                      order.reconciliationStatus
                    )}
                  </td>
                  <td>{order.billingType}</td>
                  {!isReadOnly && (
                    <td>
                      <div className="inline-actions">
                        {order.status === 'Draft' ? (
                          <button
                            className="button ghost"
                            type="button"
                            disabled={busyAction !== null}
                            onClick={async () => {
                              setBusyAction(`submit-${order.id}`);
                              try { await orderService.submitOrder(order.id as number, currentUser); } catch { setShowForbidden(true); } finally { setBusyAction(null); }
                            }}
                          >
                            {busyAction === `submit-${order.id}` ? 'Submitting...' : 'Submit'}
                          </button>
                        ) : null}
                        {order.status === 'Pending' && order.billingType === 'Compensation' && isManagerOrAdmin ? (
                          <button className="button ghost" type="button" disabled={busyAction !== null} onClick={() => setCompOrder(order)}>
                            Approve
                          </button>
                        ) : null}
                        {order.status === 'Approved' ? (
                          <button
                            className="button ghost"
                            type="button"
                            disabled={busyAction !== null}
                            onClick={async () => {
                              setBusyAction(`pay-${order.id}`);
                              try { await orderService.markPaid(order.id as number, currentUser); } finally { setBusyAction(null); }
                            }}
                          >
                            {busyAction === `pay-${order.id}` ? 'Processing...' : 'Mark Paid'}
                          </button>
                        ) : null}
                        {order.status === 'Paid' && isManagerOrAdmin ? (
                          <button
                            className="button ghost"
                            type="button"
                            disabled={busyAction !== null}
                            onClick={async () => {
                              setBusyAction(`refund-${order.id}`);
                              try { await orderService.refundOrder(order.id as number, 'Manual refund', currentUser); } catch { setShowForbidden(true); } finally { setBusyAction(null); }
                            }}
                          >
                            {busyAction === `refund-${order.id}` ? 'Refunding...' : 'Refund'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!isReadOnly && (
        <>
          <ExceptionModal
            open={Boolean(exceptionSession)}
            sessionLabel={exceptionSession ? `Session ${exceptionSession.id}` : ''}
            anomalyReason={exceptionSession?.anomalyReason}
            onClose={() => setExceptionSession(null)}
            onResolve={async (resolution, reason) => {
              if (!exceptionSession) {
                return;
              }
              try {
                await sessionService.resolveAnomaly(exceptionSession.id as number, resolution, reason, currentUser);
                setExceptionSession(null);
              } catch {
                setShowForbidden(true);
              }
            }}
          />

          <CompensationModal
            open={Boolean(compOrder)}
            order={compOrder}
            canApprove={['SystemAdministrator', 'SiteManager'].includes(currentUser.role)}
            onClose={() => setCompOrder(null)}
            onApprove={async () => {
              if (!compOrder) {
                return;
              }
              try {
                await orderService.approveCompensation(compOrder.id as number, currentUser);
                setCompOrder(null);
              } catch {
                setShowForbidden(true);
              }
            }}
            onReject={async (note) => {
              if (!compOrder) {
                return;
              }
              try {
                await orderService.rejectCompensation(compOrder.id as number, note || 'Rejected', currentUser);
                setCompOrder(null);
              } catch {
                setShowForbidden(true);
              }
            }}
          />
        </>
      )}
    </section>
  );
}
