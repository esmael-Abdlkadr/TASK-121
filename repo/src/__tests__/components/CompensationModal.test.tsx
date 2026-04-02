import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CompensationModal from '../../components/CompensationModal';

const order = {
  id: 1,
  operationId: 'op',
  sessionId: 1,
  siteId: 1,
  orderNumber: 'CB-SITE-001-20260401-0001',
  status: 'Pending' as const,
  billingType: 'Compensation' as const,
  durationMinutes: 10,
  ratePerMinute: 1,
  subtotal: 10,
  adjustmentAmount: -2,
  totalAmount: 8,
  invoiceNotes: 'x',
  reconciliationStatus: 'Unreconciled' as const,
  version: 1
};

describe('CompensationModal', () => {
  it('shows approve actions for manager/admin and read-only for attendant', () => {
    const { rerender } = render(
      <CompensationModal
        open
        order={order}
        canApprove
        onClose={() => undefined}
        onApprove={async () => undefined}
        onReject={async () => undefined}
      />
    );
    expect(screen.getByText(/approve compensation/i)).toBeTruthy();

    rerender(
      <CompensationModal
        open
        order={order}
        canApprove={false}
        onClose={() => undefined}
        onApprove={async () => undefined}
        onReject={async () => undefined}
      />
    );
    expect(screen.queryByText(/approve compensation/i)).toBeNull();
    expect(screen.getByText(/read-only view/i)).toBeTruthy();
  });
});
