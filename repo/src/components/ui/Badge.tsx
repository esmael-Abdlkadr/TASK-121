import type { PropsWithChildren } from 'react';

interface Props {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

export default function Badge({ tone = 'neutral', children }: PropsWithChildren<Props>) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
