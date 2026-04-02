import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReservationDrawer from '../../components/ReservationDrawer';

const mocks = vi.hoisted(() => ({ confirmArrival: vi.fn() }));

vi.mock('../../services/qrService', () => ({
  qrService: {
    toDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,fakeqr'),
    encodePayload: vi.fn((p: unknown) => JSON.stringify(p)),
    parsePayload: vi.fn((s: string) => JSON.parse(s))
  }
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 1, siteId: 1, role: 'Attendant' },
    encryptionKey: {} as CryptoKey
  })
}));

vi.mock('../../services/reservationService', () => ({
  reservationService: {
    getReservationDetail: vi.fn(async () => ({
      id: 1,
      customerName: 'Alex',
      customerPlate: 'ABC123',
      scheduledStart: Date.now(),
      scheduledEnd: Date.now() + 60_000,
      status: 'Scheduled',
      qrCode: '{}'
    })),
    confirmArrival: mocks.confirmArrival,
    startTempLeave: vi.fn(),
    endTempLeave: vi.fn()
  },
  TempLeaveLimitError: class TempLeaveLimitError extends Error {}
}));

let liveQueryCall = 0;
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => {
    liveQueryCall += 1;
    if (liveQueryCall % 2 === 1) {
      return {
        id: 1,
        customerName: 'Alex',
        customerPlate: 'ABC123',
        scheduledStart: Date.now(),
        scheduledEnd: Date.now() + 60_000,
        status: 'Scheduled',
        qrCode: '{}'
      };
    }
    return null;
  }
}));

describe('ReservationDrawer', () => {
  it('shows confirm button and submits manual + qr payload', async () => {
    mocks.confirmArrival.mockReset();
    await act(async () => {
      render(<ReservationDrawer reservationId={1} onClose={() => undefined} />);
    });
    await waitFor(() => {
      expect(screen.getByText(/confirm arrival/i)).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/confirm arrival/i));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/qr scanner input/i), {
        target: { value: '{}' }
      });
      fireEvent.click(screen.getByText(/scan qr code/i));
    });
    expect(mocks.confirmArrival).toHaveBeenCalled();
  });
});
