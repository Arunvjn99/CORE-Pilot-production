import { type Metrics, metricsSchema } from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, makeSession } from '../../test-fixtures';
import { SESSION_QUERY_KEY } from '../auth/use-session';
import { MetricsPage } from './metrics-page';

const empty: Metrics = metricsSchema.parse({
  days: 30,
  totals: {
    runs: 0,
    succeeded: 0,
    failed: 0,
    screens: 0,
    inputTokens: 0,
    outputTokens: 0,
    avgReviewScore: null,
    avgDurationMs: null,
  },
  byAgent: [],
  byModel: [],
  byDay: [],
  byProject: [],
  errors: [],
});

const full: Metrics = metricsSchema.parse({
  days: 7,
  totals: {
    runs: 12,
    succeeded: 10,
    failed: 2,
    screens: 31,
    inputTokens: 900,
    outputTokens: 100,
    avgReviewScore: 87.5,
    avgDurationMs: 42_300,
  },
  byAgent: [
    {
      agent: 'ui',
      calls: 12,
      failures: 1,
      inputTokens: 500,
      outputTokens: 60,
      avgDurationMs: 15_000,
    },
  ],
  byModel: [{ model: 'gpt-x', calls: 40, tokens: 1000 }],
  byDay: [{ day: '2026-11-16', runs: 12, tokens: 1000, failed: 2 }],
  byProject: [
    {
      projectId: '77777777-7777-4777-8777-777777777777',
      name: 'Loans app',
      runs: 12,
      tokens: 1000,
      screens: 31,
    },
  ],
  errors: [{ code: 'rate_limited', count: 2 }],
});

function stubMetrics(byDays: Record<number, Metrics>) {
  const fetchMock = vi.fn((path: string) => {
    const days = Number(new URL(path, 'http://x').searchParams.get('days'));
    const data = byDays[days];
    return Promise.resolve(data ? json(200, data) : json(500, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(SESSION_QUERY_KEY, makeSession());
  return render(
    <QueryClientProvider client={client}>
      <MetricsPage />
    </QueryClientProvider>,
  );
}

const stat = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MetricsPage', () => {
  it('shows zero totals and empty states for a quiet period', async () => {
    const fetchMock = stubMetrics({ 30: empty });
    renderPage();
    expect(await screen.findByText('Design runs')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/studio/metrics?days=30', expect.anything());
    expect(within(stat('Design runs')).getByText('0')).toBeInTheDocument();
    expect(within(stat('Avg review score')).getByText('—')).toBeInTheDocument();
    expect(within(stat('Avg run time')).getByText('—')).toBeInTheDocument();
    expect(screen.getAllByText('No data in this period.')).toHaveLength(5);
    expect(screen.getByText('No failures in this period.')).toBeInTheDocument();
  });

  it('renders totals and breakdowns for the chosen period', async () => {
    const fetchMock = stubMetrics({ 30: empty, 7: full });
    renderPage();
    await screen.findByText('Design runs');
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'Last 7 days');

    expect(await screen.findByText('31')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/studio/metrics?days=7', expect.anything());
    expect(within(stat('Design runs')).getByText('12')).toBeInTheDocument();
    expect(within(stat('Design runs')).getByText('10 succeeded · 2 failed')).toBeInTheDocument();
    expect(within(stat('Avg review score')).getByText('87.5')).toBeInTheDocument();
    expect(within(stat('Avg run time')).getByText('42.3 s')).toBeInTheDocument();
    const agents = screen.getByRole('table');
    expect(
      within(agents).getByRole('row', { name: /UI designer 12 1 15.0 s/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Loans app')).toBeInTheDocument();
    expect(screen.getByText('gpt-x')).toBeInTheDocument();
    expect(screen.getByText('rate_limited')).toBeInTheDocument();
    expect(screen.queryByText('No failures in this period.')).toBeNull();
  });

  it('reports when metrics cannot be loaded', async () => {
    stubMetrics({});
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Metrics could not be loaded.');
  });
});
