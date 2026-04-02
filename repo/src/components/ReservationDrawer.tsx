import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import { qrService } from '../services/qrService';
import { reservationService, TempLeaveLimitError } from '../services/reservationService';

interface Props {
  reservationId: number | null;
  onClose: () => void;
}

export default function ReservationDrawer({ reservationId, onClose }: Props) {
  const { currentUser, encryptionKey } = useAuth();
  const [qrPayloadInput, setQrPayloadInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const reservation = useLiveQuery(
    async () => {
      if (!reservationId || !currentUser || !encryptionKey) {
        return null;
      }
      return reservationService.getReservationDetail(reservationId, currentUser, encryptionKey);
    },
    [reservationId, currentUser, encryptionKey]
  );

  const session = useLiveQuery(
    async () => {
      if (!reservationId) {
        return null;
      }
      return db.sessions_charging.where('reservationId').equals(reservationId).last();
    },
    [reservationId]
  );

  // Generate real QR code asynchronously whenever qrCode payload changes
  useEffect(() => {
    if (!reservation?.qrCode) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    qrService.toDataUrl(reservation.qrCode).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    }).catch(() => {
      if (!cancelled) setQrDataUrl(null);
    });
    return () => { cancelled = true; };
  }, [reservation?.qrCode]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!reservationId) {
    return null;
  }

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <aside className="drawer open" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <h3>Reservation Check-In</h3>
          <button className="button ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {reservation ? (
          <>
            <p>
              <strong>Customer:</strong> {reservation.customerName}
            </p>
            <p>
              <strong>Plate:</strong> {reservation.customerPlate}
            </p>
            <p>
              <strong>Schedule:</strong> {new Date(reservation.scheduledStart).toLocaleString()} -{' '}
              {new Date(reservation.scheduledEnd).toLocaleString()}
            </p>

            {reservation.status === 'Scheduled' ? (
              <div className="drawer-actions">
                <button
                  className="button primary"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!currentUser || busy) {
                      return;
                    }
                    setBusy(true);
                    try {
                      await reservationService.confirmArrival(reservation.id as number, 'manual', currentUser);
                      setMessage('Arrival confirmed manually.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? 'Confirming...' : 'Confirm Arrival'}
                </button>

                <input
                  value={qrPayloadInput}
                  onChange={(event) => setQrPayloadInput(event.target.value)}
                  onKeyDown={async (event) => {
                    if (event.key !== 'Enter' || !qrPayloadInput || !currentUser || busy) {
                      return;
                    }
                    setBusy(true);
                    try {
                      await reservationService.confirmArrival(
                        reservation.id as number,
                        'qr',
                        currentUser,
                        qrPayloadInput
                      );
                      setMessage('Arrival confirmed via QR scan.');
                    } catch (err) {
                      setMessage(err instanceof Error ? err.message : 'QR scan failed.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  placeholder="QR Scanner Input"
                  aria-label="QR Scanner Input"
                />
                <button
                  className="button ghost"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!currentUser || busy) {
                      return;
                    }
                    setBusy(true);
                    try {
                      await reservationService.confirmArrival(
                        reservation.id as number,
                        'qr',
                        currentUser,
                        qrPayloadInput
                      );
                      setMessage('Arrival confirmed via QR scan.');
                    } catch (err) {
                      setMessage(err instanceof Error ? err.message : 'QR scan failed.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Scan QR Code
                </button>
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Scan QR from image file"
                  disabled={busy}
                  onChange={async (event) => {
                    const imgFile = event.target.files?.[0];
                    if (!imgFile || !currentUser || busy) {
                      return;
                    }
                    setBusy(true);
                    try {
                      const decoded = await qrService.decodeFromFile(imgFile);
                      if (!decoded) {
                        setMessage('Could not decode QR from image.');
                        return;
                      }
                      await reservationService.confirmArrival(
                        reservation.id as number,
                        'qr',
                        currentUser,
                        decoded
                      );
                      setMessage('Arrival confirmed via QR image scan.');
                    } catch (err) {
                      setMessage(err instanceof Error ? err.message : 'QR image scan failed.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </div>
            ) : null}

            {session ? (
              <div className="drawer-actions">
                <p>
                  <strong>Session Status:</strong> {session.status}
                </p>
                {session.status === 'Active' ? (
                  <button
                    className="button ghost"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (!currentUser || busy) {
                        return;
                      }
                      setBusy(true);
                      try {
                        await reservationService.startTempLeave(session.id as number, currentUser);
                        setMessage('Temporary leave started.');
                      } catch (error) {
                        if (error instanceof TempLeaveLimitError) {
                          setMessage('Temp leave limit reached.');
                        }
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Start Temp Leave
                  </button>
                ) : null}

                {session.status === 'TempLeave' ? (
                  <button
                    className="button ghost"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (!currentUser || busy) {
                        return;
                      }
                      setBusy(true);
                      try {
                        await reservationService.endTempLeave(session.id as number, currentUser);
                        setMessage('Temporary leave ended.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    End Temp Leave
                  </button>
                ) : null}
              </div>
            ) : null}

            {qrDataUrl ? <img src={qrDataUrl} alt="Reservation QR Code" className="qr-preview" /> : null}
            {message ? <p>{message}</p> : null}
          </>
        ) : (
          <p>Loading reservation...</p>
        )}
      </aside>
    </div>
  );
}
