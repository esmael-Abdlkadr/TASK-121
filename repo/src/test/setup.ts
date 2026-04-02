import 'fake-indexeddb/auto';

// Stub HTMLCanvasElement.getContext so jsdom does not emit
// "Not implemented: HTMLCanvasElement.prototype.getContext" warnings
// during component tests that render QR-code canvases.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => {
    return null;
  }) as typeof HTMLCanvasElement.prototype.getContext;
}
