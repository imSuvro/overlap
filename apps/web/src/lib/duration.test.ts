import { describe, expect, it } from 'vitest';
import { formatMarkedTime } from './duration.js';

describe('formatMarkedTime', () => {
  it('says nothing yet rather than zero', () => {
    expect(formatMarkedTime(0, 30)).toBe('nothing yet');
    expect(formatMarkedTime(0, 60)).toBe('nothing yet');
  });

  it('stays in minutes below an hour', () => {
    expect(formatMarkedTime(1, 15)).toBe('15 minutes');
    expect(formatMarkedTime(1, 30)).toBe('30 minutes');
    expect(formatMarkedTime(3, 15)).toBe('45 minutes');
  });

  it('is singular only at exactly one hour', () => {
    expect(formatMarkedTime(2, 30)).toBe('1 hour');
    expect(formatMarkedTime(1, 60)).toBe('1 hour');
    expect(formatMarkedTime(3, 30)).toBe('1½ hours');
    expect(formatMarkedTime(5, 15)).toBe('1¼ hours');
  });

  it('renders every quarter fraction each slot size can produce', () => {
    expect(formatMarkedTime(9, 15)).toBe('2¼ hours');
    expect(formatMarkedTime(10, 15)).toBe('2½ hours');
    expect(formatMarkedTime(11, 15)).toBe('2¾ hours');
    expect(formatMarkedTime(4, 60)).toBe('4 hours');
  });

  it('falls back to raw minutes for a slot size that is not a quarter hour', () => {
    // Unreachable through the protocol, which constrains slots to 15/30/60. Covered because
    // "renders undefined" is the failure mode if the lookup is ever missed.
    expect(formatMarkedTime(1, 70)).toBe('70 minutes');
  });

  it('never returns a negative or empty string', () => {
    expect(formatMarkedTime(-3, 30)).toBe('nothing yet');
  });
});
