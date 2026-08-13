export type { Hlc, HybridLogicalClockOptions } from './hlc.js';
export {
  HybridLogicalClock,
  MAX_CLOCK_DRIFT_MS,
  compareHlc,
  decodeHlc,
  encodeHlc,
  hlcEquals,
  hlcGreaterThan,
} from './hlc.js';

export type { LwwSnapshot, Register } from './lww.js';
export { LwwMap } from './lww.js';
