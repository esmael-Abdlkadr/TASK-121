import { FormEvent, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ReservationDrawer from '../components/ReservationDrawer';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import { BayConflictError, reservationService } from '../services/reservationService';
import { cryptoService } from '../services/cryptoService';
import type { Reservation } from '../types';

function maskPlate(plate: string): string {
  const trimmed = plate.trim();
  if (trimmed.length <= 3) {
    return `***${trimmed}`;
  }
  return `***${trimmed.slice(-3)}`;
}

export default function ReservationsPage() {
  const { currentUser, encryptionKey, hasRole } = useAuth();
  const bays = useLiveQuery(
    () =>
      db.bays
        .where('siteId')
        .equals(currentUser?.siteId ?? -1)
        .toArray(),
    [currentUser?.siteId]
  );

  const reservations = useLiveQuery(
    () =>
      db.reservations
        .where('siteId')
        .equals(currentUser?.siteId ?? -1)
        .toArray(),
    [currentUser?.siteId]
  );

  const reservationPlateById = useLiveQuery(async () => {
    if (!encryptionKey) {
      return new Map<number, string>();
    }
    const map = new Map<number, string>();
    for (const reservation of reservations ?? []) {
      if (!reservation.id) {
        continue;
      }
      try {
        map.set(
          reservation.id,
          await cryptoService.decryptField(reservation.customerPlate, encryptionKey)
        );
      } catch {
        map.set(reservation.id, '(encrypted)');
      }
    }
    return map;
  }, [reservations, encryptionKey]);

  const [drawerReservationId, setDrawerReservationId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    bayId: '',
    customerName: '',
    customerPlate: '',
    scheduledStart: '',
    scheduledEnd: ''
  });

  const scheduledByBay = useMemo(() => {
    const lookup = new Map<number, Reservation>();
    (reservations ?? []).forEach((reservation) => {
      if (reservation.status === 'Scheduled' || reservation.status === 'Active' || reservation.status === 'CheckedIn') {
        lookup.set(reservation.bayId, reservation);
      }
    });
    return lookup;
  }, [reservations]);

  if (!currentUser) {
    return null;
  }

  const canCreate = hasRole('Attendant', 'SiteManager', 'SystemAdministrator');

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!encryptionKey) {
      setError('Encryption key not available. Please re-authenticate.');
      return;
    }

    setBusy(true);
    try {
      await reservationService.createReservation(
        {
          operationId: crypto.randomUUID(),
          bayId: Number(form.bayId),
          siteId: currentUser.siteId as number,
          userId: currentUser.id as number,
          customerName: form.customerName,
          customerPlate: form.customerPlate,
          scheduledStart: new Date(form.scheduledStart).getTime(),
          scheduledEnd: new Date(form.scheduledEnd).getTime()
        },
        currentUser,
        encryptionKey
      );

      setShowCreate(false);
      setForm({ bayId: '', customerName: '', customerPlate: '', scheduledStart: '', scheduledEnd: '' });
    } catch (submitError) {
      if (submitError instanceof BayConflictError) {
        setError('Bay is already reserved in the selected time window.');
      } else {
        setError('Unable to create reservation.');
      }
    } finally {
      setBusy(false);
    }
  };

  const isLoading = bays === undefined || reservations === undefined;

  return (
    <section className="card">
      <div className="page-header">
        <h1>Reservations</h1>
        {canCreate ? (
          <button className="button primary" type="button" onClick={() => setShowCreate(true)}>
            New Reservation
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="muted">Loading bays...</p>
      ) : (bays ?? []).length === 0 ? (
        <p className="muted">No bays configured for this site.</p>
      ) : (
        <div className="bay-grid">
          {(bays ?? []).map((bay) => {
            const reservation = scheduledByBay.get(bay.id as number);
            const remainingMs = reservation ? reservation.scheduledStart - Date.now() : null;

            return (
              <article key={bay.id} className="bay-card">
                <h3>{bay.label}</h3>
                <p>
                  <strong>Status:</strong> {bay.status}
                </p>
                {reservation ? (
                  <>
                    <p>
                      <strong>Reservation:</strong>{' '}
                      {maskPlate(reservationPlateById?.get(reservation.id as number) ?? '---')}
                    </p>
                    <p>
                      <strong>Starts in:</strong>{' '}
                      {remainingMs !== null ? `${Math.max(0, Math.ceil(remainingMs / 60_000))} min` : '-'}
                    </p>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => setDrawerReservationId(reservation.id as number)}
                    >
                      Check In
                    </button>
                  </>
                ) : (
                  <p className="muted">No active reservation</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {showCreate ? (
        <div className="overlay" role="presentation" onClick={() => !busy && setShowCreate(false)}>
          <form className="modal" onClick={(event) => event.stopPropagation()} onSubmit={onSubmit}>
            <h3>New Reservation</h3>
            <select
              required
              value={form.bayId}
              disabled={busy}
              onChange={(event) => setForm((previous) => ({ ...previous, bayId: event.target.value }))}
            >
              <option value="">Select bay</option>
              {(bays ?? [])
                .filter((bay) => bay.status === 'Available' || bay.status === 'Reserved')
                .map((bay) => (
                  <option key={bay.id} value={bay.id}>
                    {bay.label}
                  </option>
                ))}
            </select>
            <input
              placeholder="Customer Name"
              value={form.customerName}
              onChange={(event) => setForm((previous) => ({ ...previous, customerName: event.target.value }))}
              required
              disabled={busy}
            />
            <input
              placeholder="Customer Plate"
              value={form.customerPlate}
              onChange={(event) => setForm((previous) => ({ ...previous, customerPlate: event.target.value }))}
              required
              disabled={busy}
            />
            <input
              type="datetime-local"
              value={form.scheduledStart}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, scheduledStart: event.target.value }))
              }
              required
              disabled={busy}
            />
            <input
              type="datetime-local"
              value={form.scheduledEnd}
              onChange={(event) => setForm((previous) => ({ ...previous, scheduledEnd: event.target.value }))}
              required
              disabled={busy}
            />
            {error ? <p className="error">{error}</p> : null}
            <div className="modal-actions">
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Save Reservation'}
              </button>
              <button className="button ghost" type="button" onClick={() => setShowCreate(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ReservationDrawer reservationId={drawerReservationId} onClose={() => setDrawerReservationId(null)} />
    </section>
  );
}
