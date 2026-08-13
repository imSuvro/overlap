import type { RawData } from 'ws';

/**
 * Decodes a `ws` frame to text.
 *
 * `RawData` is `Buffer | ArrayBuffer | Buffer[]`, and calling `.toString()` on it blindly
 * yields `[object Object]` for the fragmented case — a corruption that would only show up
 * under message fragmentation, which is exactly when it is hardest to debug.
 */
export function decodeFrame(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}
