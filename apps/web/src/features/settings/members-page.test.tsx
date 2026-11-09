import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json, makeSession, TEAM_ID } from '../../test-fixtures';
import { SESSION_QUERY_KEY } from '../auth/use-session';
import { assignableRoles, MembersPage } from './members-page';

const members = [
  {
    userId: '11111111-1111-4111-8111-111111111111',
    displayName: 'Ada Lovelace',
    email: 'ada@corp.test',
    role: 'org_admin',
  },
  {
    userId: '33333333-3333-4333-8333-333333333333',
    displayName: 'Grace Hopper',
    email: null,
    role: 'org_owner',
  },
  {
    userId: '44444444-4444-4444-8444-444444444444',
    displayName: 'Alan Turing',
    email: 'alan@corp.test',
    role: 'designer',
  },
];

function renderPage(session = makeSession()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(SESSION_QUERY_KEY, session);
  return render(
    <QueryClientProvider client={client}>
      <MembersPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assignableRoles', () => {
  it('lets only owners and company admins assign the owner role', () => {
    expect(assignableRoles(makeSession(), 'org_admin')).not.toContain('org_owner');
    expect(assignableRoles(makeSession(), 'org_owner')).toContain('org_owner');
    expect(
      assignableRoles(makeSession({ user: { ...makeSession().user, platformAdmin: true } }), null),
    ).toContain('org_owner');
  });
});

describe('MembersPage', () => {
  it('is read-only for members without members:manage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, members)));
    renderPage();
    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('lets admins change roles they may assign but not owners', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, members))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf');
    renderPage(
      makeSession({
        organizations: [{ id: TEAM_ID, name: 'Design Team', role: 'org_admin' }],
        permissions: ['members:read', 'members:manage', 'projects:read'],
      }),
    );
    await screen.findByText('Alan Turing');
    expect(screen.getByRole('button', { name: 'Add member' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Role for Grace Hopper' })).toBeNull();
    const select = screen.getByRole('combobox', { name: 'Role for Alan Turing' });
    expect(within(select).queryByRole('option', { name: 'Owner' })).toBeNull();
    await userEvent.selectOptions(select, 'viewer');
    const call = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, RequestInit];
    expect(call[0]).toBe(`/api/v1/orgs/${TEAM_ID}/members/44444444-4444-4444-8444-444444444444`);
    expect(call[1].body).toBe(JSON.stringify({ role: 'viewer' }));
  });

  it('shows the API error when a change is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, members))
      .mockResolvedValueOnce(
        json(400, {
          error: {
            code: 'LAST_OWNER',
            message: 'A team must keep at least one owner',
            correlationId: 'c',
          },
        }),
      )
      .mockResolvedValue(json(200, members));
    vi.stubGlobal('fetch', fetchMock);
    renderPage(
      makeSession({
        user: { ...makeSession().user, platformAdmin: true },
        permissions: ['members:read', 'members:manage'],
      }),
    );
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Role for Grace Hopper' }),
      'viewer',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one owner');
  });
});
