import {
  type AgentDefinition,
  agentDefinitionSchema,
  type AgentVersion,
  agentVersionSchema,
  updateAgentSchema,
} from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json, makeSession } from '../../test-fixtures';
import { SESSION_QUERY_KEY } from '../auth/use-session';
import { AgentsPage } from './agents-page';

const agent = (overrides: Partial<AgentDefinition>): AgentDefinition =>
  agentDefinitionSchema.parse({
    key: 'orchestrator',
    name: 'Orchestrator',
    description: 'Plans the screens.',
    version: 0,
    instructions: 'You plan the screens of the requested flow.',
    model: null,
    enabled: true,
    customized: false,
    updatedAt: null,
    updatedByName: null,
    ...overrides,
  });

const agents: AgentDefinition[] = [
  agent({
    key: 'orchestrator',
    version: 3,
    customized: true,
    model: 'gpt-x',
    updatedAt: '2026-11-12T09:30:00.000Z',
    updatedByName: 'Ada Lovelace',
  }),
  agent({
    key: 'ux',
    name: 'UX designer',
    description: 'Structures each screen.',
    instructions: 'You design the structure of every screen.',
  }),
  agent({
    key: 'ui',
    name: 'UI designer',
    description: 'Builds the screens.',
    instructions: 'You build each screen in the design system.',
  }),
  agent({
    key: 'reviewer',
    name: 'Reviewer',
    description: 'Checks the screens.',
    instructions: 'You review every screen for accessibility.',
    enabled: false,
  }),
];

const versions: AgentVersion[] = [3, 2, 1].map((version) =>
  agentVersionSchema.parse({
    version,
    instructions: `Version ${String(version)} instructions for the orchestrator.`,
    model: version === 3 ? 'gpt-x' : null,
    enabled: true,
    createdAt: '2026-11-12T09:30:00.000Z',
    authorName: 'Ada Lovelace',
  }),
);

const WRITER: Parameters<typeof makeSession>[0] = {
  permissions: ['members:read', 'projects:read', 'projects:write', 'providers:read'],
};

const stale = () =>
  json(409, {
    error: {
      code: 'STALE_VERSION',
      message: 'Someone saved a newer version. Reload to see it.',
      correlationId: 'corr-1',
    },
  });

type Handler = (init: RequestInit | undefined) => Response;
function stubApi(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    'GET /api/v1/studio/agents': () => json(200, agents),
    'GET /api/v1/studio/agents/orchestrator/versions': () => json(200, versions),
    'GET /api/v1/studio/agents/ux/versions': () => json(200, []),
    'GET /api/v1/studio/agents/ui/versions': () => json(200, []),
    'GET /api/v1/studio/agents/reviewer/versions': () => json(200, []),
    ...overrides,
  };
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${path}`];
    return Promise.resolve(handler ? handler(init) : json(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodiesOf = (fetchMock: ReturnType<typeof stubApi>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(([p, init]) => p === path && init?.method === method)
    .map(([, init]) => JSON.parse(init?.body as string) as unknown);

function renderPage(session = makeSession()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(SESSION_QUERY_KEY, session);
  setCsrfToken('csrf');
  return render(
    <QueryClientProvider client={client}>
      <AgentsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentsPage', () => {
  it('lists the agents in pipeline order with their status', async () => {
    stubApi();
    renderPage(makeSession(WRITER));
    const nav = await screen.findByRole('navigation', { name: 'Agents' });
    await within(nav).findByRole('button', { name: /Reviewer/ });
    const buttons = within(nav)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(buttons).toEqual([
      'OrchestratorVersion 3',
      'UX designerDefault',
      'UI designerDefault',
      'ReviewerDefault · off',
    ]);
    expect(screen.getByRole('button', { name: /Orchestrator/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByLabelText('Instructions')).toHaveValue(agents[0]?.instructions);
    expect(screen.getByLabelText(/Model/)).toHaveValue('gpt-x');
    expect(await screen.findByRole('heading', { name: /Version history/ })).toBeInTheDocument();
  });

  it('saves a new version with the expected version', async () => {
    const fetchMock = stubApi({
      'PUT /api/v1/studio/agents/ux': (init) => {
        const body = updateAgentSchema.parse(JSON.parse(init?.body as string));
        return json(200, { ...agents[1], ...body, version: 1, customized: true });
      },
    });
    renderPage(makeSession(WRITER));
    await userEvent.click(await screen.findByRole('button', { name: /UX designer/ }));
    const save = screen.getByRole('button', { name: 'Save new version' });
    expect(save).toBeDisabled();

    const instructions = screen.getByLabelText('Instructions');
    await userEvent.clear(instructions);
    await userEvent.type(instructions, 'Design accessible, mobile-first screens.');
    await userEvent.type(screen.getByLabelText(/Model/), '  gpt-y  ');
    await userEvent.click(screen.getByRole('checkbox', { name: /Enabled/ }));
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PUT', '/api/v1/studio/agents/ux')).toEqual([
        {
          instructions: 'Design accessible, mobile-first screens.',
          model: 'gpt-y',
          enabled: false,
          expectedVersion: 0,
        },
      ]);
    });
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(new Headers(put?.[1]?.headers).get('x-csrf-token')).toBe('csrf');
    // The list is refreshed after saving.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([p, init]) => p === '/api/v1/studio/agents' && (init?.method ?? 'GET') === 'GET',
        ),
      ).toHaveLength(2);
    });
  });

  it('sends an empty model as null (team default)', async () => {
    const fetchMock = stubApi({
      'PUT /api/v1/studio/agents/orchestrator': () => json(200, { ...agents[0], version: 4 }),
    });
    renderPage(makeSession(WRITER));
    await userEvent.clear(await screen.findByLabelText(/Model/));
    await userEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PUT', '/api/v1/studio/agents/orchestrator')).toEqual([
        {
          instructions: agents[0]?.instructions,
          model: null,
          enabled: true,
          expectedVersion: 3,
        },
      ]);
    });
  });

  it('shows the conflict message when the version is stale', async () => {
    stubApi({ 'PUT /api/v1/studio/agents/orchestrator': stale });
    renderPage(makeSession(WRITER));
    await userEvent.type(await screen.findByLabelText('Instructions'), ' Be concise.');
    await userEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone saved a newer version. Reload to see it.',
    );
    // The unsaved edit is kept so it is not lost.
    expect(screen.getByLabelText('Instructions')).toHaveValue(
      `${agents[0]?.instructions ?? ''} Be concise.`,
    );
  });

  it('does not let required agents be disabled', async () => {
    stubApi();
    renderPage(makeSession(WRITER));
    expect(await screen.findByRole('checkbox', { name: /Enabled/ })).toBeDisabled();
    expect(screen.getByText('Required for every run.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /UI designer/ }));
    expect(screen.getByRole('checkbox', { name: /Enabled/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Enabled/ })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: /Reviewer/ }));
    const reviewer = screen.getByRole('checkbox', { name: /Enabled/ });
    expect(reviewer).toBeEnabled();
    expect(reviewer).not.toBeChecked();
    expect(screen.queryByText('Required for every run.')).toBeNull();
  });

  it('restores an earlier version and resets to the default', async () => {
    const fetchMock = stubApi({
      'POST /api/v1/studio/agents/orchestrator/revert': () =>
        json(200, { ...agents[0], version: 4 }),
    });
    renderPage(makeSession(WRITER));
    await screen.findByRole('heading', { name: /Version history/ });
    // The current version cannot be "restored".
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: 'Restore' })[1] as HTMLElement);
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'POST', '/api/v1/studio/agents/orchestrator/revert')).toEqual([
        { toVersion: 1, expectedVersion: 3 },
      ]);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'POST', '/api/v1/studio/agents/orchestrator/revert')).toEqual([
        { toVersion: 1, expectedVersion: 3 },
        { toVersion: 0, expectedVersion: 3 },
      ]);
    });
  });

  it('shows the conflict message when a restore is stale', async () => {
    stubApi({ 'POST /api/v1/studio/agents/orchestrator/revert': stale });
    renderPage(makeSession(WRITER));
    await userEvent.click(await screen.findByRole('button', { name: 'Reset to default' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone saved a newer version. Reload to see it.',
    );
  });

  it('offers no reset for an agent still on the shipped default', async () => {
    stubApi();
    renderPage(makeSession(WRITER));
    await userEvent.click(await screen.findByRole('button', { name: /UX designer/ }));
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull();
  });

  it('is read-only without projects:write', async () => {
    const fetchMock = stubApi();
    renderPage();
    expect(await screen.findByLabelText('Instructions')).toBeDisabled();
    expect(screen.getByLabelText(/Model/)).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Enabled/ })).toBeDisabled();
    await screen.findByRole('heading', { name: /Version history/ });
    expect(screen.queryByRole('button', { name: 'Save new version' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(
      false,
    );
  });

  it('reports when the agents cannot be loaded', async () => {
    stubApi({ 'GET /api/v1/studio/agents': () => json(500, {}) });
    renderPage(makeSession(WRITER));
    expect(await screen.findByRole('alert')).toHaveTextContent('Agents could not be loaded.');
  });
});
