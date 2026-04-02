import type { ChangeEvent } from 'react';

interface Props {
  headers: string[];
  requiredFields: string[];
  fieldMap: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

export default function FieldMapper({ headers, requiredFields, fieldMap, onChange }: Props) {
  const requiredSet = new Set(requiredFields);

  return (
    <table className="table">
      <thead>
        <tr>
          <th>CSV Column</th>
          <th>Target Field</th>
        </tr>
      </thead>
      <tbody>
        {headers.map((header) => (
          <tr key={header}>
            <td>{header}</td>
            <td>
              <select
                value={fieldMap[header] ?? ''}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  onChange({
                    ...fieldMap,
                    [header]: event.target.value
                  })
                }
              >
                <option value="">Unmapped</option>
                {requiredFields.map((field) => (
                  <option key={field} value={field}>
                    {requiredSet.has(field) ? `${field} *` : field}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
