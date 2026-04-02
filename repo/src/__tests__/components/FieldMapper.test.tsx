import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FieldMapper from '../../components/import/FieldMapper';
import { importService } from '../../services/importService';

describe('FieldMapper', () => {
  it('auto maps stationId and blocks unmapped required fields', () => {
    const map = importService.autoMapFields(['stationId', 'foo'], 'reservations');
    expect(map.stationId).toBe('stationId');

    const onChange = vi.fn();
    render(
      <FieldMapper
        headers={['stationId', 'foo']}
        requiredFields={['stationId', 'connectorId']}
        fieldMap={map}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'connectorId' } });
    expect(onChange).toHaveBeenCalled();
  });
});
