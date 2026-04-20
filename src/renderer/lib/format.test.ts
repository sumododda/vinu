import { describe, expect, it } from 'vitest';
import { formatDuration, formatRelativeTime } from './format';

describe('formatRelativeTime', () => {
  it('formats seconds, minutes, hours, days', () => {
    const now = 100_000_000;
    expect(formatRelativeTime(now - 5_000, now)).toBe('5s ago');
    expect(formatRelativeTime(now - 90_000, now)).toBe('2m ago');
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('1h ago');
    expect(formatRelativeTime(now - 86_400_000 * 3, now)).toBe('3d ago');
  });
});

describe('formatDuration', () => {
  it('zero-pads mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65_000)).toBe('01:05');
  });
});
