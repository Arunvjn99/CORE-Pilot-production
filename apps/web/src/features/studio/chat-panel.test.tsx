import { type Run, type RunEvent, runEventSchema, runSchema } from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json } from '../../test-fixtures';
import { ChatPanel, errorText } from './chat-panel';

const PROJECT_ID = '77777777-7777-4777-8777-777777777777';
const RUN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUNS_PATH = `/api/v1/projects/${PROJECT_ID}/runs`;

/** jsdom has no EventSource; this records instances so tests can push server-sent events. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = FakeEventSource.OPEN;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emitRaw(data: string) {
    act(() => {
      this.onmessage?.(new MessageEvent('message', { data }));
    });
  }
  /** A dropped connection: `retrying` keeps CONNECTING (browser retries), otherwise CLOSED. */
  fail(retrying: boolean) {
    this.readyState = retrying ? FakeEventSource.CONNECTING : FakeEventSource.CLOSED;
    act(() => {
      this.onerror?.();
    });
  }
  emit(event: RunEvent) {
    this.emitRaw(JSON.stringify(runEventSchema.parse(event)));
  }
}

const previousRun: Run = runSchema.parse({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  projectId: PROJECT_ID,
  status: 'succeeded',
  prompt: 'A sign-in screen',
  title: 'Sign in',
  errorCode: null,
  startedByName: 'Ada Lovelace',
  startedAt: '2026-11-10T10:00:00.000Z',
  finishedAt: '2026-11-10T10:01:00.000Z',
  inputTokens: 1000,
  outputTokens: 500,
  screens: 2,
  reviewScore: 92,
  traced: true,
  steps: [],
});

type Handler = (init: RequestInit | undefined) => Response;
function stubApi(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    [`GET ${RUNS_PATH}`]: () => json(200, [previousRun]),
    [`POST ${RUNS_PATH}`]: () => json(201, { id: RUN_ID }),
    ...overrides,
  };
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${path}`];
    return Promise.resolve(handler ? handler(init) : json(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(canWrite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setCsrfToken('csrf');
  const router = createMemoryRouter(
    [{ path: '/studio', element: <ChatPanel projectId={PROJECT_ID} canWrite={canWrite} /> }],
    { initialEntries: ['/studio'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client };
}

async function startRun(prompt = 'A loan request flow') {
  await userEvent.type(await screen.findByLabelText('Design request'), prompt);
  await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await waitFor(() => {
    expect(FakeEventSource.instances).toHaveLength(1);
  });
  const source = FakeEventSource.instances[0];
  if (!source) throw new Error('no event source');
  return source;
}

const timelineRows = () =>
  within(screen.getByRole('region', { name: 'Current run' }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent);

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('errorText', () => {
  it('maps known codes and names unknown ones', () => {
    expect(errorText(null)).toBeNull();
    expect(errorText('timeout')).toBe('The model took too long to respond.');
    expect(errorText('weird_code')).toBe('The run failed (weird_code).');
  });
});

describe('ChatPanel', () => {
  it('posts the trimmed prompt and follows the run events stream', async () => {
    const fetchMock = stubApi();
    renderPanel();
    const source = await startRun('  A loan request flow  ');

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe(RUNS_PATH);
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({ prompt: 'A loan request flow' });
    expect(new Headers(post?.[1]?.headers).get('x-csrf-token')).toBe('csrf');
    expect(source.url).toBe(`${RUNS_PATH}/${RUN_ID}/events`);

    expect(screen.getByLabelText('Design request')).toHaveValue('');
    expect(screen.getByLabelText('Design request')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Agents are working…' })).toBeDisabled();
  });

  it('does not start a run for a prompt shorter than three characters', async () => {
    const fetchMock = stubApi();
    renderPanel();
    await userEvent.type(await screen.findByLabelText('Design request'), ' ab ');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('renders run events as a timeline and refreshes data when done', async () => {
    stubApi();
    const { client } = renderPanel();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const source = await startRun();

    source.emit({ type: 'step_started', agent: 'orchestrator', label: 'Planning' });
    expect(timelineRows()).toEqual(['Orchestrator: Planning']);

    source.emit({
      type: 'step_finished',
      agent: 'orchestrator',
      label: 'Planning',
      model: 'gpt-x',
      inputTokens: 1200,
      outputTokens: 300,
      durationMs: 2500,
    });
    source.emit({
      type: 'plan',
      title: 'Loan request',
      summary: 'Three screens',
      screens: [
        { name: 'Eligibility', route: '/' },
        { name: 'Amount', route: '/amount' },
      ],
      todos: [],
    });
    source.emit({ type: 'step_started', agent: 'ui', label: 'Building screens' });
    source.emit({ type: 'screen', name: 'Eligibility', route: '/' });
    source.emit({
      type: 'review',
      round: 0,
      screens: [
        { route: '/', score: 92, pass: true, checks: [], fixes: [] },
        { route: '/amount', score: 61, pass: false, checks: [], fixes: ['contrast'] },
      ],
    });
    source.emit({
      type: 'review',
      round: 1,
      screens: [{ route: '/amount', score: 88, pass: true, checks: [], fixes: [] }],
    });
    source.emit({ type: 'saved', revision: 4, checkpointId: null });

    expect(timelineRows()).toEqual([
      // The started step is replaced by its finished row.
      `Orchestrator: Planning${(1500).toLocaleString()} tokens · 2.5 s`,
      'Plan: Loan requestEligibility · Amount',
      'UI designer: Building screens',
      'Review/ 92 · /amount 61',
      'Review after fixes (round 1)/amount 88',
      'Saved to the project and checkpointed',
    ]);
    expect(source.closed).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();

    source.emit({ type: 'done', status: 'succeeded', errorCode: null });
    expect(source.closed).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
    expect(screen.getByLabelText('Design request')).toBeEnabled();
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['studio', 'screens', PROJECT_ID],
        ['studio', 'runs', PROJECT_ID],
        ['projects'],
      ]),
    );
  });

  it('lists the plan’s to-dos, checked once the run succeeds', async () => {
    stubApi();
    renderPanel();
    const source = await startRun();
    source.emit({
      type: 'plan',
      title: 'Sign-in',
      summary: '',
      screens: [{ name: 'Sign in', route: '/' }],
      todos: ['Plan the screens', 'Build in CORE 2.0'],
    });
    const todos = await screen.findByRole('list', { name: 'Plan to-dos' });
    expect(within(todos).getAllByLabelText('To do')).toHaveLength(2);
    expect(todos).toHaveTextContent('Build in CORE 2.0');
    source.emit({ type: 'done', status: 'succeeded', errorCode: null });
    await waitFor(() => {
      expect(within(todos).getAllByLabelText('Done')).toHaveLength(2);
    });
  });

  it('shows failed steps and the error of a failed run', async () => {
    stubApi();
    renderPanel();
    const source = await startRun();
    source.emit({ type: 'step_started', agent: 'ux', label: 'Wireframes' });
    source.emit({ type: 'step_failed', agent: 'ux', label: 'Wireframes', code: 'timeout' });
    source.emit({ type: 'done', status: 'failed', errorCode: 'unauthorized' });

    expect(timelineRows()).toEqual(['UX designer: Wireframestimeout']);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The provider rejected the API key. Check Settings → AI providers.',
    );
    expect(source.closed).toBe(true);
  });

  it('still explains a failed run that has no error code', async () => {
    stubApi();
    renderPanel();
    const source = await startRun();
    source.emit({ type: 'done', status: 'failed', errorCode: null });
    expect(screen.getByRole('alert')).toHaveTextContent('The run failed.');
  });

  it('keeps waiting while the browser reconnects, and gives up cleanly when it cannot', async () => {
    const fetchMock = stubApi();
    renderPanel();
    const source = await startRun();
    source.emit({ type: 'step_started', agent: 'orchestrator', label: 'Planning screens' });
    source.fail(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Design request')).toBeDisabled();

    const runListReads = () =>
      fetchMock.mock.calls.filter(([path, init]) => path === RUNS_PATH && !init?.method).length;
    const before = runListReads();
    source.fail(false);
    expect(screen.getByRole('alert')).toHaveTextContent('Lost the connection to this run');
    expect(screen.getByLabelText('Design request')).toBeEnabled();
    await waitFor(() => {
      expect(runListReads()).toBeGreaterThan(before);
    });
  });

  it('ignores malformed and unknown events', async () => {
    stubApi();
    renderPanel();
    const source = await startRun();
    source.emitRaw('not json');
    source.emitRaw(JSON.stringify({ type: 'shell', command: 'rm -rf /' }));
    source.emitRaw(JSON.stringify({ type: 'step_started', agent: 'hacker', label: 'x' }));
    source.emitRaw(JSON.stringify({ type: 'done', status: 'exploded', errorCode: null }));
    expect(timelineRows()).toEqual([]);
    expect(source.closed).toBe(false);
    expect(screen.getByRole('button', { name: 'Agents are working…' })).toBeDisabled();
  });

  it('shows why a run could not start, with a link to AI providers when no model is set', async () => {
    stubApi({
      [`POST ${RUNS_PATH}`]: () =>
        json(409, {
          error: {
            code: 'NO_DEFAULT_MODEL',
            message: 'Choose a default model first.',
            correlationId: 'corr-1',
          },
        }),
    });
    renderPanel();
    await userEvent.type(await screen.findByLabelText('Design request'), 'A dashboard');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Choose a default model first.');
    expect(within(alert).getByRole('link', { name: 'Open AI providers' })).toHaveAttribute(
      'href',
      '/settings/ai-providers',
    );
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(screen.getByLabelText('Design request')).toHaveValue('A dashboard');
  });

  it('lists previous runs and hides the prompt form without write access', async () => {
    stubApi();
    renderPanel(false);
    await userEvent.click(await screen.findByText('Previous runs (1)'));
    expect(screen.getByText('A sign-in screen')).toBeInTheDocument();
    expect(
      screen.getByText(`2 screens · ${(1500).toLocaleString()} tokens · score 92`),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Design request')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
  });

  it('closes the event stream on unmount', async () => {
    stubApi();
    renderPanel();
    const source = await startRun();
    expect(source.closed).toBe(false);
    cleanup();
    expect(source.closed).toBe(true);
  });
});
