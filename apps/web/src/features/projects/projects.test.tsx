import { routeFromName } from '@core-studio/contracts';
import { describe, expect, it } from 'vitest';
import { timeAgo } from '../../lib/time';
import { applyTheme, setTheme } from '../../lib/theme';

describe('helpers', () => {
  it('suggests routes from page names', () => {
    expect(routeFromName('Getting Started')).toBe('/getting-started');
    expect(routeFromName('  Café & Bar!! ')).toBe('/cafe-bar');
    expect(routeFromName('???')).toBe('/');
  });
  it('formats relative times', () => {
    const base = Date.parse('2026-11-09T12:00:00Z');
    expect(timeAgo('2026-11-09T11:59:50Z', base)).toBe('just now');
    expect(timeAgo('2026-11-09T09:00:00Z', base)).toBe('3 hours ago');
  });
  it('applies the theme preference to the document', () => {
    setTheme('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    setTheme('system');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    applyTheme('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    setTheme('system');
  });
});
