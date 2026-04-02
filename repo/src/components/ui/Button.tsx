import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export default function Button({ variant = 'primary', children, ...props }: PropsWithChildren<Props>) {
  return (
    <button {...props} className={`button ${variant} ${props.className ?? ''}`.trim()}>
      {children}
    </button>
  );
}
