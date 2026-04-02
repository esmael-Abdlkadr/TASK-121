import type { PropsWithChildren } from 'react';

interface Props {
  columns: string[];
}

export default function Table({ columns, children }: PropsWithChildren<Props>) {
  return (
    <table className="table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
