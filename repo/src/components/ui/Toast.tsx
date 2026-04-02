interface Props {
  message: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
}

export default function Toast({ message, tone = 'info' }: Props) {
  return <div className={`toast ${tone}`}>{message}</div>;
}
