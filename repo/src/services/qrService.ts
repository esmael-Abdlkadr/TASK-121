import QRCode from 'qrcode';

interface ReservationQrPayload {
  reservationId: number;
  operationId: string;
  siteCode: string;
}

function encodePayload(payload: ReservationQrPayload): string {
  return JSON.stringify(payload);
}

function parsePayload(qrPayload: string): ReservationQrPayload {
  return JSON.parse(qrPayload) as ReservationQrPayload;
}

async function toDataUrl(payload: string): Promise<string> {
  try {
    return await QRCode.toDataURL(payload, {
      width: 220,
      margin: 2,
      color: { dark: '#111827', light: '#ffffff' }
    });
  } catch {
    // Fallback for environments without canvas support (e.g. test jsdom)
    return `data:text/plain;base64,${btoa(encodeURIComponent(payload))}`;
  }
}

// BarcodeDetector is Chromium-native; gracefully degrade when unavailable.
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

async function decodeFromFile(file: File): Promise<string | null> {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w['BarcodeDetector'] === 'undefined') {
    return null;
  }
  const Detector = w['BarcodeDetector'] as BarcodeDetectorConstructor;
  const detector = new Detector({ formats: ['qr_code'] });
  const bitmap = await createImageBitmap(file);
  try {
    const codes = await detector.detect(bitmap);
    return codes.length > 0 ? codes[0].rawValue : null;
  } finally {
    bitmap.close();
  }
}

export const qrService = {
  encodePayload,
  parsePayload,
  toDataUrl,
  decodeFromFile
};
