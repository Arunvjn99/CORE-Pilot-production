import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiSend } from '../../lib/api-client';
import { AuthGate } from './auth-gate';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Ada',
    email: null,
    platformAdmin: false,
  },
  organizations: [],
  activeOrganizationId: null,
  permissions: [],
  csrfToken: 'csrf-123',
  recentAuthUntil: null,
};

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <p>Protected content</p>
      </AuthGate>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthGate', () => {
  it('shows the sign-in page when the session is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json(401, { error: { code: 'UNAUTHORIZED', message: 'x', correlationId: 'c' } }),
        ),
    );
    renderGate();
    const link = await screen.findByRole('link', { name: 'Sign in with Microsoft' });
    expect(link.getAttribute('href')).toBe('/api/v1/auth/login?returnTo=%2F');
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('renders children for a valid session and keeps the CSRF token in memory only', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, session))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderGate();
    expect(await screen.findByText('Protected content')).toBeInTheDocument();
    await apiSend('POST', '/api/v1/orgs/x/activate');
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-123');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('shows an outage message for non-auth failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json(503, { error: { code: 'X', message: 'down', correlationId: 'c' } }),
        ),
    );
    renderGate();
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  });
});
