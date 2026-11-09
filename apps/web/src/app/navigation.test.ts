import { describe, expect, it } from 'vitest';
import { makeSession } from '../test-fixtures';
import { visibleNavItems } from './navigation';

describe('visibleNavItems', () => {
  it('shows entries the user has permission for', () => {
    expect(visibleNavItems(makeSession()).map((i) => i.label)).toEqual(['Projects', 'Settings']);
  });
  it('hides entries without permission', () => {
    expect(
      visibleNavItems(makeSession({ permissions: ['projects:read'] })).map((i) => i.label),
    ).toEqual(['Projects']);
  });
});
