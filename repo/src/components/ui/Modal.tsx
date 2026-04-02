import type { PropsWithChildren } from 'react';

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
}

export default function Modal({ title, open, onClose, children }: PropsWithChildren<Props>) {
  if (!open) {
    return null;
  }

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="button ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
