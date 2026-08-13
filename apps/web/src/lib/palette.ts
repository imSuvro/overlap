/**
 * Bridges CSS custom properties into the canvas.
 *
 * The heatmap is painted, not styled, so it cannot inherit from the stylesheet. Rather than
 * duplicating the palette as JavaScript constants — where it would drift from the CSS the
 * moment either is edited — the values are read back from the live computed style and cached.
 *
 * This is the concrete cost of the canvas decision in ADR-0005, and it is small: one read per
 * theme change.
 */

export interface Palette {
  readonly heat: readonly string[];
  readonly void: string;
  readonly voidStripe: string;
  readonly surface: string;
  readonly line: string;
  readonly ink: string;
  readonly inkSoft: string;
  readonly inkFaint: string;
  readonly accent: string;
}

const HEAT_STEPS = ['--heat-0', '--heat-1', '--heat-2', '--heat-3', '--heat-4', '--heat-5'];

/** Used only if a custom property is missing, which would mean the stylesheet failed to load. */
const FALLBACK = '#cccccc';

function readVariable(styles: CSSStyleDeclaration, name: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : FALLBACK;
}

export function readPalette(element: HTMLElement): Palette {
  const styles = getComputedStyle(element);
  return {
    heat: HEAT_STEPS.map((name) => readVariable(styles, name)),
    void: readVariable(styles, '--void'),
    voidStripe: readVariable(styles, '--void-stripe'),
    surface: readVariable(styles, '--surface'),
    line: readVariable(styles, '--line'),
    ink: readVariable(styles, '--ink'),
    inkSoft: readVariable(styles, '--ink-soft'),
    inkFaint: readVariable(styles, '--ink-faint'),
    accent: readVariable(styles, '--accent'),
  };
}

/**
 * Maps a weighted headcount onto the ramp.
 *
 * Anchored on the largest count actually present rather than on the participant total, so a
 * room where nobody is free for everything still shows contrast instead of a flat wash of the
 * palest step.
 */
export function heatColour(palette: Palette, score: number, peak: number): string {
  const steps = palette.heat;
  const last = steps.length - 1;
  if (score <= 0 || peak <= 0) return steps[0] ?? FALLBACK;

  const ratio = Math.min(1, score / peak);
  const index = Math.max(1, Math.min(last, Math.round(ratio * last)));
  return steps[index] ?? FALLBACK;
}

/** A stable, readable colour per participant, derived from their id — see `hueForParticipant`. */
export function participantColour(hue: number, dark: boolean): string {
  return dark ? `hsl(${hue} 70% 62%)` : `hsl(${hue} 62% 45%)`;
}
