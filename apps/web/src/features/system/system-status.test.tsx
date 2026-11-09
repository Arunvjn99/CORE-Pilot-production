import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatus } from './system-status';

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemStatus />
    </QueryClientProvider>,
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SystemStatus', () => {
  it('shows the API as online when health succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json(200, { status: 'ok', service: 'api', version: '1.2.3', checks: {} }),
        ),
    );
    renderWithClient();
    expect(await screen.findByText('Platform API online (version 1.2.3)')).toBeInTheDocument();
  });

  it('shows the API as unavailable on an error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(503, {
          error: { code: 'SERVICE_UNAVAILABLE', message: 'down', correlationId: 'c' },
        }),
      ),
    );
    renderWithClient();
    expect(await screen.findByText('Platform API unavailable')).toBeInTheDocument();
  });

  it('treats a malformed success payload as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { unexpected: true })));
    renderWithClient();
    expect(await screen.findByText('Platform API unavailable')).toBeInTheDocument();
  });

  it('uses same-origin credentials and no bearer token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json(200, { status: 'ok', service: 'api', version: '1', checks: {} }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient();
    await screen.findByText(/online/);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
  });
});
