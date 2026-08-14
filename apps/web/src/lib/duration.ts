/**
 * How much time someone has marked, in the units they arrived with.
 *
 * The room counts in slots because that is what the grid is made of, but nobody planning dinner
 * thinks in slots — "5 slots" is our vocabulary leaking into their screen. Slot sizes are 15, 30
 * or 60 minutes, so every total is a multiple of a quarter hour and the quarter fractions cover
 * the whole range exactly.
 */
const QUARTER_FRACTIONS: Record<number, string> = {
  0: '',
  15: '¼',
  30: '½',
  45: '¾',
};

export function formatMarkedTime(slotCount: number, slotMinutes: number): string {
  const minutes = slotCount * slotMinutes;
  if (minutes <= 0) return 'nothing yet';

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const fraction = QUARTER_FRACTIONS[remainder];

  // A slot size outside 15/30/60 would land here. Rendering the raw minutes is wrong in no way
  // that matters, and it is a great deal better than rendering `undefined`.
  if (fraction === undefined) return `${String(minutes)} minutes`;

  if (hours === 0) return `${String(remainder)} minutes`;

  const plural = hours === 1 && remainder === 0 ? 'hour' : 'hours';
  return `${String(hours)}${fraction} ${plural}`;
}
