import type { Permission, SessionResponse } from '@core-studio/contracts';

export const TEAM_ID = '22222222-2222-4222-8222-222222222222';

export function makeSession(
  overrides: Partial<SessionResponse> & { permissions?: Permission[] } = {},
): SessionResponse {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      displayName: 'Ada Lovelace',
      email: 'ada@corp.test',
      platformAdmin: false,
    },
    organizations: [{ id: TEAM_ID, name: 'Design Team', role: 'designer' }],
    activeOrganizationId: TEAM_ID,
    permissions: ['members:read', 'projects:read', 'providers:read'],
    csrfToken: 'csrf',
    recentAuthUntil: null,
    ...overrides,
  };
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
