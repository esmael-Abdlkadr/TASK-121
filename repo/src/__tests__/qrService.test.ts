/**
 * QR service tests.
 * Verifies that qrService generates a real QR-encoded data URL,
 * that the encode/parse round-trip is correct, and that the
 * decodeFromFile path works via BarcodeDetector (mocked in jsdom).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { qrService } from '../services/qrService';

describe('qrService', () => {
  it('encodePayload/parsePayload round-trips correctly', () => {
    const payload = { reservationId: 42, operationId: 'op-abc', siteCode: 'SITE-001' };
    const encoded = qrService.encodePayload(payload);
    const decoded = qrService.parsePayload(encoded);
    expect(decoded.reservationId).toBe(42);
    expect(decoded.operationId).toBe('op-abc');
    expect(decoded.siteCode).toBe('SITE-001');
  });

  it('toDataUrl returns a non-empty data URL for a JSON payload', async () => {
    const payload = qrService.encodePayload({ reservationId: 1, operationId: 'op-1', siteCode: 'S1' });
    const url = await qrService.toDataUrl(payload);
    expect(typeof url).toBe('string');
    expect(url.startsWith('data:')).toBe(true);
    expect(url.length).toBeGreaterThan(50);
  });

  it('toDataUrl produces different URLs for different payloads', async () => {
    const url1 = await qrService.toDataUrl(qrService.encodePayload({ reservationId: 1, operationId: 'a', siteCode: 'S' }));
    const url2 = await qrService.toDataUrl(qrService.encodePayload({ reservationId: 2, operationId: 'b', siteCode: 'S' }));
    expect(url1).not.toBe(url2);
  });
});

describe('qrService.decodeFromFile', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['BarcodeDetector'];
    delete (window as unknown as Record<string, unknown>)['createImageBitmap'];
    vi.restoreAllMocks();
  });

  it('returns null when BarcodeDetector is not available in the environment', async () => {
    delete (window as unknown as Record<string, unknown>)['BarcodeDetector'];
    const file = new File([''], 'qr.png', { type: 'image/png' });
    const result = await qrService.decodeFromFile(file);
    expect(result).toBeNull();
  });

  it('returns decoded QR string when BarcodeDetector detects a code', async () => {
    const rawValue = qrService.encodePayload({ reservationId: 42, operationId: 'op-xyz', siteCode: 'SITE-001' });
    const mockBitmap = { close: vi.fn() };
    (window as unknown as Record<string, unknown>)['createImageBitmap'] = vi.fn().mockResolvedValue(mockBitmap);
    const mockDetect = vi.fn().mockResolvedValue([{ rawValue }]);
    const MockDetector = vi.fn().mockImplementation(() => ({ detect: mockDetect }));
    (window as unknown as Record<string, unknown>)['BarcodeDetector'] = MockDetector;

    const file = new File([''], 'qr.png', { type: 'image/png' });
    const result = await qrService.decodeFromFile(file);
    expect(result).toBe(rawValue);
    expect(MockDetector).toHaveBeenCalledWith({ formats: ['qr_code'] });
  });

  it('returns null when BarcodeDetector finds no codes in the image', async () => {
    const mockBitmap = { close: vi.fn() };
    (window as unknown as Record<string, unknown>)['createImageBitmap'] = vi.fn().mockResolvedValue(mockBitmap);
    const mockDetect = vi.fn().mockResolvedValue([]);
    const MockDetector = vi.fn().mockImplementation(() => ({ detect: mockDetect }));
    (window as unknown as Record<string, unknown>)['BarcodeDetector'] = MockDetector;

    const file = new File([''], 'blank.png', { type: 'image/png' });
    const result = await qrService.decodeFromFile(file);
    expect(result).toBeNull();
  });

  it('encode→decode round-trip: decoded value parses back to original payload', async () => {
    const original = { reservationId: 7, operationId: 'op-round', siteCode: 'SITE-RT' };
    const encoded = qrService.encodePayload(original);
    const mockBitmap = { close: vi.fn() };
    (window as unknown as Record<string, unknown>)['createImageBitmap'] = vi.fn().mockResolvedValue(mockBitmap);
    const mockDetect = vi.fn().mockResolvedValue([{ rawValue: encoded }]);
    const MockDetector = vi.fn().mockImplementation(() => ({ detect: mockDetect }));
    (window as unknown as Record<string, unknown>)['BarcodeDetector'] = MockDetector;

    const file = new File([''], 'qr.png', { type: 'image/png' });
    const decoded = await qrService.decodeFromFile(file);
    expect(decoded).not.toBeNull();
    const parsed = qrService.parsePayload(decoded!);
    expect(parsed.reservationId).toBe(7);
    expect(parsed.operationId).toBe('op-round');
    expect(parsed.siteCode).toBe('SITE-RT');
  });
});
