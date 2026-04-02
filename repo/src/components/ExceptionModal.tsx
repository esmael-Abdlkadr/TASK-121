import { useState } from 'react';

interface Props {
  open: boolean;
  sessionLabel: string;
  anomalyReason?: string;
  onClose: () => void;
  onResolve: (resolution: 'complete' | 'cancel', reason: string) => Promise<void>;
}

export default function ExceptionModal({
  open,
  sessionLabel,
  anomalyReason,
  onClose,
  onResolve
}: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(event) => event.stopPropagation()}>
        <h3>Resolve Session Anomaly</h3>
        <p>
          <strong>Session:</strong> {sessionLabel}
        </p>
        <p>
          <strong>Anomaly:</strong> {anomalyReason ?? 'Unknown'}
        </p>
        <textarea
          className="text-area"
          placeholder="Resolution reason (min 10 chars)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {error ? <p className="error">{error}</p> : null}
        <div className="modal-actions">
          <button
            className="button primary"
            type="button"
            onClick={async () => {
              if (reason.trim().length < 10) {
                setError('Reason must be at least 10 characters.');
                return;
              }
              await onResolve('complete', reason);
              setReason('');
            }}
          >
            Complete & Bill
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={async () => {
              if (reason.trim().length < 10) {
                setError('Reason must be at least 10 characters.');
                return;
              }
              await onResolve('cancel', reason);
              setReason('');
            }}
          >
            Cancel Without Billing
          </button>
        </div>
      </div>
    </div>
  );
}
