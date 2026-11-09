import type { CredentialSummary } from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json, makeSession, TEAM_ID } from '../../test-fixtures';
import { SESSION_QUERY_KEY } from '../auth/use-session';
import { AiProvidersPage } from './ai-providers-page';
import { maskedKey, probeStatus } from './providers';

const SECRET = 'sk-test-TYPED-SECRET-0123456789';
const CRED_ID = '55555555-5555-4555-8555-555555555555';

const teamCredential: CredentialSummary = {
  id: CRED_ID,
  scope: 'organization',
  provider: 'openai',
  label: 'Team OpenAI',
  endpoint: null,
  apiVersion: null,
  deployment: null,
  status: 'active',
  hasSecret: true,
  displayHint: '…cdef',
  createdAt: '2026-11-01T10:00:00.000Z',
  rotatedAt: null,
  lastTestCode: 'ok',
  lastTestedAt: '2026-11-02T10:00:00.000Z',
};

const MANAGER: Parameters<typeof makeSession>[0] = {
  organizations: [{ id: TEAM_ID, name: 'Design Team', role: 'org_admin' }],
  permissions: [
    'members:read',
    'projects:read',
    'providers:read',
    'providers:manage',
    'credentials:personal',
  ],
};
const recent = () => new Date(Date.now() + 5 * 60_000).toISOString();

type Handler = (init: RequestInit | undefined) => Response;
function stubApi(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    'GET /api/v1/llm/credentials': () => json(200, [teamCredential]),
    'GET /api/v1/llm/policy': () => json(200, { allowPersonalCredentials: false }),
    'GET /api/v1/llm/default-model': () => json(200, { defaultModel: null }),
    'GET /api/v1/llm/activity': () => json(200, []),
    ...overrides,
  };
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    return Promise.resolve(handler ? handler(init) : json(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(session = makeSession()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(SESSION_QUERY_KEY, session);
  setCsrfToken('csrf');
  return render(
    <QueryClientProvider client={client}>
      <AiProvidersPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('helpers', () => {
  it('masks keys and never invents characters', () => {
    expect(maskedKey(true, '…cdef')).toBe('•••• cdef');
    expect(maskedKey(true, null)).toBe('•••• (hidden)');
    expect(maskedKey(false, null)).toBe('No key');
  });
  it('maps probe codes to labels', () => {
    expect(probeStatus('unauthorized').label).toBe('Key rejected');
    expect(probeStatus(null).label).toBe('Not tested');
    expect(probeStatus('something-new').label).toBe('Unknown');
  });
});

describe('AiProvidersPage', () => {
  it('is read-only for members without providers:manage', async () => {
    stubApi();
    renderPage();
    const card = screen.getByRole('listitem', {
      name: (await screen.findByRole('heading', { name: 'Team OpenAI' })).textContent,
    });
    expect(within(card).getByLabelText('Masked key')).toHaveTextContent('•••• cdef');
    expect(within(card).getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add credential/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /test connection/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /revoke/i })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('asks for re-authentication before credential changes', async () => {
    stubApi();
    renderPage(makeSession(MANAGER));
    await userEvent.click(await screen.findByRole('button', { name: 'Add credential' }));
    const link = await screen.findByRole('link', { name: 'Confirm identity' });
    expect(link).toHaveAttribute(
      'href',
      '/api/v1/auth/step-up?returnTo=%2Fsettings%2Fai-providers',
    );
    expect(screen.queryByLabelText('API key')).toBeNull();
  });

  it('saves a key write-only and clears it from the form', async () => {
    let posted: unknown = null;
    const fetchMock = stubApi({
      'POST /api/v1/llm/credentials': (init) => {
        posted = JSON.parse(init?.body as string);
        return json(201, { ...teamCredential, id: '66666666-6666-4666-8666-666666666666' });
      },
    });
    renderPage(makeSession({ ...MANAGER, recentAuthUntil: recent() }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add credential' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Anthropic/ }));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Claude prod');
    const key = within(dialog).getByLabelText('API key');
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('autocomplete', 'off');
    await userEvent.type(key, SECRET);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save credential' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(posted).toEqual({
      scope: 'organization',
      provider: 'anthropic',
      label: 'Claude prod',
      secret: SECRET,
    });
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
    expect(new Headers(post?.[1]?.headers).get('x-csrf-token')).toBe('csrf');
    expect(document.body.innerHTML).not.toContain(SECRET);

    await userEvent.click(screen.getByRole('button', { name: 'Add credential' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText('API key')).toHaveValue('');
  });

  it('shows provider-specific fields', async () => {
    stubApi();
    renderPage(makeSession({ ...MANAGER, recentAuthUntil: recent() }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add credential' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Endpoint')).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Azure OpenAI/ }));
    expect(within(dialog).getByLabelText('Endpoint')).toBeRequired();
    expect(within(dialog).getByLabelText('Deployment')).toBeRequired();
    expect(within(dialog).getByLabelText('API version')).toHaveValue('2024-10-21');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Ollama/ }));
    expect(within(dialog).getByLabelText('API key (optional)')).not.toBeRequired();
    expect(within(dialog).queryByLabelText('Deployment')).toBeNull();
  });

  it('switches to the re-authentication prompt if the session window expired while typing', async () => {
    stubApi({
      'POST /api/v1/llm/credentials': () =>
        json(403, {
          error: {
            code: 'REAUTH_REQUIRED',
            message: 'Re-authentication required',
            correlationId: 'c',
          },
        }),
    });
    renderPage(makeSession({ ...MANAGER, recentAuthUntil: recent() }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add credential' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Main');
    await userEvent.type(within(dialog).getByLabelText('API key'), SECRET);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save credential' }));
    expect(
      await within(dialog).findByRole('link', { name: 'Confirm identity' }),
    ).toBeInTheDocument();
  });

  it('tests a connection and reports the outcome', async () => {
    stubApi({
      [`POST /api/v1/llm/credentials/${CRED_ID}/test`]: () =>
        json(200, {
          credentialId: CRED_ID,
          code: 'unauthorized',
          message: 'The provider rejected the API key',
          latencyMs: 120,
          models: [],
          testedAt: '2026-11-09T10:00:00.000Z',
        }),
    });
    renderPage(makeSession(MANAGER));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Test connection for Team OpenAI' }),
    );
    expect(await screen.findByText('Key rejected')).toBeInTheDocument();
    expect(screen.getByText('The provider rejected the API key')).toBeInTheDocument();
  });

  it('sets the default model from models the key can reach', async () => {
    let saved: unknown = null;
    stubApi({
      [`POST /api/v1/llm/credentials/${CRED_ID}/test`]: () =>
        json(200, {
          credentialId: CRED_ID,
          code: 'ok',
          message: 'Connected',
          latencyMs: 80,
          models: ['gpt-a', 'gpt-b'],
          testedAt: '2026-11-09T10:00:00.000Z',
        }),
      'PUT /api/v1/llm/default-model': (init) => {
        saved = JSON.parse(init?.body as string);
        return new Response(null, { status: 204 });
      },
    });
    renderPage(makeSession(MANAGER));
    await userEvent.selectOptions(await screen.findByLabelText('Credential'), CRED_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Load models' }));
    await userEvent.selectOptions(await screen.findByLabelText('Model'), 'gpt-b');
    await userEvent.click(screen.getByRole('button', { name: 'Set as default' }));
    await waitFor(() => {
      expect(saved).toEqual({ credentialId: CRED_ID, model: 'gpt-b' });
    });
  });

  it('explains when personal credentials are disabled', async () => {
    stubApi();
    renderPage(makeSession(MANAGER));
    await userEvent.click(await screen.findByRole('tab', { name: /Personal/ }));
    expect(await screen.findByText(/Personal credentials are turned off/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add personal key' })).toBeNull();
  });
});
