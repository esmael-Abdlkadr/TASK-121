import { useState } from 'react';
import type { Order } from '../types';

interface Props {
  open: boolean;
  order: Order | null;
  canApprove?: boolean;
  onClose: () => void;
  onApprove: () => Promise<void>;
  onReject: (note: string) => Promise<void>;
}

export default function CompensationModal({
  open,
  order,
  canApprove = true,
  onClose,
  onApprove,
  onReject
}: Props) {
  const [note, setNote] = useState('');

  if (!open || !order) {
    return null;
  }

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(event) => event.stopPropagation()}>
        <h3>Compensation Approval</h3>
        <p>
          <strong>Order:</strong> {order.orderNumber}
        </p>
        <p>
          <strong>Adjustment:</strong> ${order.adjustmentAmount.toFixed(2)}
        </p>
        <p>
          <strong>Reason:</strong> {order.adjustmentReason || '-'}
        </p>
        <textarea
          className="text-area"
          placeholder="Optional rejection note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {canApprove ? (
          <div className="modal-actions">
            <button className="button primary" type="button" onClick={onApprove}>
              Approve Compensation
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={async () => {
                await onReject(note);
                setNote('');
              }}
            >
              Reject
            </button>
          </div>
        ) : (
          <p>Read-only view</p>
        )}
      </div>
    </div>
  );
}
