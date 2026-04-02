import type { PropsWithChildren } from 'react';

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
}

export default function Drawer({ title, open, onClose, children }: PropsWithChildren<Props>) {
  return (
    <aside className={`drawer ${open ? 'open' : ''}`}>
      <div className="drawer-header">
        <h3>{title}</h3>
        <button className="button ghost" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div>{children}</div>
    </aside>
  );
}
