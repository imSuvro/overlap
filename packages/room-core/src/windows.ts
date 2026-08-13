import { LEVEL, LEVEL_WEIGHT, type Level } from '@overlap/protocol';
import { slotDurationMs, type Slot, type SlotMinutes } from '@overlap/time';
import type { RoomState } from './state.js';

export interface CandidateWindow {
  readonly startInstant: number;
  /** Exclusive. */
  readonly endInstant: number;
  readonly slotCount: number;
  /** Weighted headcount: `available` counts 1, `ifNeedBe` counts 0.5. */
  readonly score: number;
  /** Free for **every** slot in the window. */
  readonly available: readonly string[];
  /** Could make **every** slot work, but at least one only grudgingly. */
  readonly ifNeedBe: readonly string[];
  /** Cannot do at least one slot in the window, or has not answered. */
  readonly unavailable: readonly string[];
}

export interface FindWindowsOptions {
  readonly slots: readonly Slot[];
  readonly state: RoomState;
  readonly participantIds: readonly string[];
  readonly slotMinutes: SlotMinutes;
  /** How many consecutive slots the meeting needs. Defaults to one hour's worth. */
  readonly windowSlots?: number;
  readonly limit?: number;
}

interface ScoredWindow extends CandidateWindow {
  readonly runIndex: number;
  readonly offset: number;
}

/**
 * Splits slots into maximal runs of genuinely consecutive instants.
 *
 * Adjacency is checked on the timeline rather than on array position, so a run breaks wherever
 * there is real elapsed time between two slots — in practice, overnight between one day's
 * window closing and the next one opening. Without this, a "2 hour window" could be proposed
 * spanning 4:30pm Tuesday to 9:30am Wednesday.
 *
 * Worth being precise about the DST case, because the intuition points the wrong way: a
 * transition does **not** break a run. Clocks jumping from 01:59 to 03:00 leaves the instants
 * exactly 30 minutes apart, because only the labels moved. That the timeline stays continuous
 * through a transition is the entire benefit of keying on instants instead of wall times, and
 * it means a meeting spanning one needs no special handling here at all.
 */
function contiguousRuns(slots: readonly Slot[], stepMs: number): Slot[][] {
  const runs: Slot[][] = [];
  let current: Slot[] = [];

  for (const slot of slots) {
    const previous = current[current.length - 1];
    if (previous && slot.instant - previous.instant !== stepMs) {
      runs.push(current);
      current = [];
    }
    current.push(slot);
  }
  if (current.length > 0) runs.push(current);

  return runs;
}

/**
 * Ranks the contiguous windows that suit the most people.
 *
 * A participant counts toward a window only if they can make **all** of it, scored at their
 * *worst* level across the window. Scoring each slot independently and averaging would happily
 * recommend a two-hour meeting that half the room can only attend the first half of.
 *
 * This is the deliberately-scoped answer to "duration preferences". It surfaces the useful
 * result — here are the times that work — without a constraint-solver UI. See docs/PLAN.md.
 */
export function findBestWindows(options: FindWindowsOptions): CandidateWindow[] {
  const { slots, state, participantIds, slotMinutes } = options;
  const limit = options.limit ?? 3;
  if (participantIds.length === 0 || slots.length === 0 || limit <= 0) return [];

  const stepMs = slotDurationMs(slotMinutes);
  const runs = contiguousRuns(
    [...slots].sort((a, b) => a.instant - b.instant),
    stepMs,
  );
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  if (longestRun === 0) return [];

  const requested = options.windowSlots ?? Math.max(1, Math.round(60 / slotMinutes));
  // A room shorter than the requested meeting still deserves an answer, so shrink to fit
  // rather than returning nothing.
  const windowSlots = Math.min(Math.max(1, requested), longestRun);

  const candidates: ScoredWindow[] = [];

  runs.forEach((run, runIndex) => {
    for (let offset = 0; offset + windowSlots <= run.length; offset += 1) {
      const available: string[] = [];
      const ifNeedBe: string[] = [];
      const unavailable: string[] = [];
      let score = 0;

      for (const participantId of participantIds) {
        let worst: Level = LEVEL.available;
        for (let step = 0; step < windowSlots; step += 1) {
          const slot = run[offset + step];
          if (!slot) break;
          const level = state.levelFor(participantId, slot.instant);
          if (level < worst) worst = level;
          if (worst === LEVEL.unavailable) break;
        }

        score += LEVEL_WEIGHT[worst];
        if (worst === LEVEL.available) available.push(participantId);
        else if (worst === LEVEL.ifNeedBe) ifNeedBe.push(participantId);
        else unavailable.push(participantId);
      }

      const first = run[offset];
      const last = run[offset + windowSlots - 1];
      if (!first || !last) continue;

      candidates.push({
        runIndex,
        offset,
        startInstant: first.instant,
        endInstant: last.instant + stepMs,
        slotCount: windowSlots,
        score,
        available,
        ifNeedBe,
        unavailable,
      });
    }
  });

  candidates.sort((a, b) => b.score - a.score || a.startInstant - b.startInstant);

  // Overlapping windows are near-duplicates of each other — "2pm-3pm" and "2:30pm-3:30pm" are
  // one suggestion, not two. Pick greedily and skip anything touching an already-chosen span.
  const chosen: CandidateWindow[] = [];
  const taken: { start: number; end: number }[] = [];

  for (const candidate of candidates) {
    if (candidate.score <= 0) break;
    const overlaps = taken.some(
      (span) => candidate.startInstant < span.end && candidate.endInstant > span.start,
    );
    if (overlaps) continue;

    taken.push({ start: candidate.startInstant, end: candidate.endInstant });
    chosen.push({
      startInstant: candidate.startInstant,
      endInstant: candidate.endInstant,
      slotCount: candidate.slotCount,
      score: candidate.score,
      available: candidate.available,
      ifNeedBe: candidate.ifNeedBe,
      unavailable: candidate.unavailable,
    });
    if (chosen.length === limit) break;
  }

  return chosen;
}

/** Weighted headcount for a single slot — what the heatmap shades against. */
export function slotScore(
  state: RoomState,
  participantIds: readonly string[],
  instant: number,
): number {
  let score = 0;
  for (const participantId of participantIds) {
    score += LEVEL_WEIGHT[state.levelFor(participantId, instant)];
  }
  return score;
}
