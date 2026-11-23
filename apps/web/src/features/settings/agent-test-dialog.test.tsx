import {
  type AgentDefinition,
  agentDefinitionSchema,
  agentTestSchema,
  designSystemSummarySchema,
} from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json, makeSession } from '../../test-fixtures';
import { SESSION_QUERY_KEY } from '../auth/use-session';
import { formatAgentOutput } from './agent-test-dialog';
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

const agents = [
  agent({}),
  agent({ key: 'ux', name: 'UX designer', instructions: 'You design the structure of screens.' }),
  agent({ key: 'ui', name: 'UI designer', instructions: 'You build each screen in the system.' }),
  agent({ key: 'reviewer', name: 'Reviewer', instructions: 'You review every screen strictly.' }),
];

const systems = [
  { slug: 'core-2', name: 'CORE 2.0', version: 0, custom: false, customized: false },
  { slug: 'minimal', name: 'Minimal', version: 0, custom: false, customized: false },
].map((s) => designSystemSummarySchema.parse(s));

const WRITER: Parameters<typeof makeSession>[0] = {
  permissions: ['projects:read', 'projects:write'],
};

const UI_OUTPUT =
  'Here it is:\n```tsx\nexport default function SignIn() {\n  return <main>Sign in</main>;\n}\n```';

type Handler = (init: RequestInit | undefined) => Response;
function stubApi(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    'GET /api/v1/studio/agents': () => json(200, agents),
    'GET /api/v1/studio/design-systems': () => json(200, systems),
    ...overrides,
  };
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const handler =
      routes[`${init?.method ?? 'GET'} ${path}`] ??
      (path.endsWith('/versions') ? () => json(200, []) : undefined);
    return Promise.resolve(handler ? handler(init) : json(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodiesOf = (fetchMock: ReturnType<typeof stubApi>, path: string) =>
  fetchMock.mock.calls
    .filter(([p, init]) => p === path && init?.method === 'POST')
    .map(([, init]) => agentTestSchema.parse(JSON.parse(init?.body as string)));

function renderPage(session = makeSession(WRITER)) {
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

describe('Test this agent', () => {
  it('runs the agent with the unsaved instructions and shows the code, tokens and time', async () => {
    const fetchMock = stubApi({
      'POST /api/v1/studio/agents/ui/test': () =>
        json(200, {
          output: UI_OUTPUT,
          valid: true,
          model: 'llama3.2:3b',
          inputTokens: 1234,
          outputTokens: 56,
          durationMs: 2500,
        }),
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /UI designer/ }));
    await userEvent.type(screen.getByLabelText('Instructions'), ' Use large touch targets.');
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));

    const dialog = await screen.findByRole('dialog', { name: 'Test UI designer' });
    const run = within(dialog).getByRole('button', { name: 'Run test' });
    expect(run).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Sample request'), 'A sign-in screen');
    await userEvent.selectOptions(within(dialog).getByLabelText('Design system'), 'minimal');
    await userEvent.click(run);

    await waitFor(() => {
      expect(bodiesOf(fetchMock, '/api/v1/studio/agents/ui/test')).toEqual([
        {
          instructions: 'You build each screen in the system. Use large touch targets.',
          prompt: 'A sign-in screen',
          designSystemSlug: 'minimal',
        },
      ]);
    });
    const result = await within(dialog).findByRole('region', { name: 'Test result' });
    expect(within(result).getByText('llama3.2:3b')).toBeInTheDocument();
    expect(result).toHaveTextContent('1,234 input tokens · 56 output tokens · 2.5 s');
    expect(result).toHaveTextContent('The output follows the format a design run needs.');
    expect(within(result).getByLabelText('Output')).toHaveTextContent(
      'export default function SignIn() { return <main>Sign in</main>; }',
    );
    expect(within(result).getByLabelText('Output').textContent).not.toContain('```');
    // Nothing is saved: no PUT of the agent.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('pretty-prints JSON output, flags output a run could not use, and omits the default system', async () => {
    const fetchMock = stubApi({
      'POST /api/v1/studio/agents/orchestrator/test': () =>
        json(200, {
          output: 'Plan: {"title":"Loans","screens":[]}',
          valid: false,
          model: 'gpt-x',
          inputTokens: 10,
          outputTokens: 5,
          durationMs: 800,
        }),
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Test' }));
    const dialog = await screen.findByRole('dialog', { name: 'Test Orchestrator' });
    await userEvent.type(within(dialog).getByLabelText('Sample request'), 'A loan application');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Run test' }));
    const output = await within(dialog).findByLabelText('Output');
    expect(output.textContent).toBe('{\n  "title": "Loans",\n  "screens": []\n}');
    expect(dialog).toHaveTextContent('A design run could not use this output');
    expect(bodiesOf(fetchMock, '/api/v1/studio/agents/orchestrator/test')).toEqual([
      { instructions: agents[0]?.instructions, prompt: 'A loan application' },
    ]);
  });

  it('shows the fixed error message when the provider fails', async () => {
    stubApi({
      'POST /api/v1/studio/agents/orchestrator/test': () =>
        json(424, {
          error: {
            code: 'AGENT_TEST_UNAUTHORIZED',
            message: 'The AI provider rejected the team key. Check it in Settings → AI providers.',
            correlationId: 'corr-1',
          },
        }),
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Test' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Sample request'), 'Anything');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Run test' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The AI provider rejected the team key.',
    );
  });

  it('cannot run with instructions that are too short', async () => {
    stubApi();
    renderPage();
    await userEvent.clear(await screen.findByLabelText('Instructions'));
    await userEvent.type(screen.getByLabelText('Instructions'), 'Too short');
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Sample request'), 'A sign-in screen');
    expect(within(dialog).getByRole('button', { name: 'Run test' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('too short to test');
  });

  it('is not offered without projects:write', async () => {
    stubApi();
    renderPage(makeSession());
    await screen.findByLabelText('Instructions');
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull();
  });
});

describe('formatAgentOutput', () => {
  it('keeps unparseable output as it is', () => {
    expect(formatAgentOutput('reviewer', ' not json ')).toBe('not json');
    expect(formatAgentOutput('ux', '{broken')).toBe('{broken');
    expect(formatAgentOutput('ui', 'export default function A() {}')).toBe(
      'export default function A() {}',
    );
  });
});
