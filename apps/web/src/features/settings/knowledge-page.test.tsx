import {
  type KnowledgeDocument,
  knowledgeDocumentSchema,
  updateKnowledgeDocumentSchema,
} from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json, makeSession } from '../../test-fixtures';
import { SESSION_QUERY_KEY } from '../auth/use-session';
import { KnowledgePage } from './knowledge-page';

const ID_1 = '33333333-3333-4333-8333-333333333331';
const ID_2 = '33333333-3333-4333-8333-333333333332';
const NEW_ID = '33333333-3333-4333-8333-333333333339';
const UPDATED_AT = '2026-11-20T10:00:00.123Z';

const doc = (overrides: Partial<KnowledgeDocument>): KnowledgeDocument =>
  knowledgeDocumentSchema.parse({
    id: ID_1,
    title: 'Tone of voice',
    body: 'Say "member", never "user".',
    enabled: true,
    createdAt: '2026-11-19T10:00:00.000Z',
    createdByName: 'Ada Lovelace',
    updatedAt: UPDATED_AT,
    updatedByName: 'Grace Hopper',
    ...overrides,
  });

const docs = [
  doc({}),
  doc({ id: ID_2, title: '401(k) wording', body: 'Never promise returns.', enabled: false }),
];

const MANAGER: Parameters<typeof makeSession>[0] = {
  permissions: ['projects:read', 'projects:write', 'design-systems:manage'],
};

type Handler = (init: RequestInit | undefined) => Response;
function stubApi(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    'GET /api/v1/studio/knowledge': () => json(200, docs),
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
      <KnowledgePage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KnowledgePage', () => {
  it('lists the documents with their status and opens the first one', async () => {
    stubApi();
    renderPage(makeSession(MANAGER));
    const nav = await screen.findByRole('navigation', { name: 'Knowledge documents' });
    await within(nav).findByRole('button', { name: /401\(k\) wording/ });
    expect(
      within(nav)
        .getAllByRole('button', { name: /wording|voice/ })
        .map((b) => b.textContent),
    ).toEqual(['Tone of voiceOn · 27 characters', '401(k) wordingOff · 22 characters']);
    expect(screen.getByRole('button', { name: /Tone of voice/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Tone of voice' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Tone of voice');
    expect(screen.getByLabelText('Content')).toHaveValue('Say "member", never "user".');
    expect(screen.getByRole('checkbox', { name: /Enabled/ })).toBeChecked();
    expect(screen.getByText(/Agents receive 27 of up to 60,000 characters/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /401\(k\) wording/ }));
    expect(screen.getByLabelText('Title')).toHaveValue('401(k) wording');
    expect(screen.getByRole('checkbox', { name: /Enabled/ })).not.toBeChecked();
  });

  it('saves an edit with the expected update time', async () => {
    const fetchMock = stubApi({
      [`PUT /api/v1/studio/knowledge/${ID_1}`]: (init) => {
        const body = updateKnowledgeDocumentSchema.parse(JSON.parse(init?.body as string));
        return json(200, { ...docs[0], ...body, updatedAt: '2026-11-20T11:00:00.000Z' });
      },
    });
    renderPage(makeSession(MANAGER));
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Content'), ' Use "plan" for 401(k).');
    await userEvent.click(screen.getByRole('checkbox', { name: /Enabled/ }));
    await userEvent.click(save);
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PUT', `/api/v1/studio/knowledge/${ID_1}`)).toEqual([
        {
          title: 'Tone of voice',
          body: 'Say "member", never "user". Use "plan" for 401(k).',
          enabled: false,
          expectedUpdatedAt: UPDATED_AT,
        },
      ]);
    });
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(new Headers(put?.[1]?.headers).get('x-csrf-token')).toBe('csrf');
  });

  it('shows the conflict message and keeps the edit when someone saved first', async () => {
    stubApi({
      [`PUT /api/v1/studio/knowledge/${ID_1}`]: () =>
        json(409, {
          error: {
            code: 'STALE_UPDATE',
            message: 'Someone saved this document after you opened it. Reload.',
            correlationId: 'corr-1',
          },
        }),
    });
    renderPage(makeSession(MANAGER));
    await userEvent.type(await screen.findByLabelText('Content'), ' More.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone saved this document after you opened it. Reload.',
    );
    expect(screen.getByLabelText('Content')).toHaveValue('Say "member", never "user". More.');
  });

  it('creates a document and selects it', async () => {
    const created = doc({ id: NEW_ID, title: 'Product facts', body: 'APR from 4.9%.' });
    let list = docs;
    const fetchMock = stubApi({
      'GET /api/v1/studio/knowledge': () => json(200, list),
      'POST /api/v1/studio/knowledge': () => {
        list = [...docs, created];
        return json(201, created);
      },
    });
    renderPage(makeSession(MANAGER));
    await userEvent.click(await screen.findByRole('button', { name: /New document/ }));
    expect(screen.getByRole('heading', { name: 'New document' })).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create document' });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Title'), '  Product facts ');
    await userEvent.type(screen.getByLabelText('Content'), 'APR from 4.9%.');
    await userEvent.click(create);
    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'POST', '/api/v1/studio/knowledge')).toEqual([
        { title: 'Product facts', body: 'APR from 4.9%.', enabled: true },
      ]);
    });
    expect(await screen.findByRole('heading', { name: 'Product facts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Product facts/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('deletes only after confirmation', async () => {
    const fetchMock = stubApi({
      [`DELETE /api/v1/studio/knowledge/${ID_1}`]: () => new Response(null, { status: 204 }),
    });
    renderPage(makeSession(MANAGER));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete “Tone of voice”?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([p, init]) => p === `/api/v1/studio/knowledge/${ID_1}` && init?.method === 'DELETE',
        ),
      ).toHaveLength(1);
    });
  });

  it('is read-only without design-systems:manage', async () => {
    const fetchMock = stubApi();
    renderPage(makeSession({ permissions: ['projects:read', 'projects:write'] }));
    expect(await screen.findByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Content')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Enabled/ })).toBeDisabled();
    expect(screen.getByText('Only team admins can edit the knowledge base.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: /New document/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(
      false,
    );
  });

  it('explains an empty knowledge base', async () => {
    stubApi({ 'GET /api/v1/studio/knowledge': () => json(200, []) });
    renderPage(makeSession(MANAGER));
    expect(await screen.findByRole('heading', { name: 'No knowledge yet' })).toBeInTheDocument();
  });

  it('warns when the enabled documents exceed what a run can carry', async () => {
    stubApi({
      'GET /api/v1/studio/knowledge': () => json(200, [doc({ body: 'x'.repeat(70_000) })]),
    });
    renderPage(makeSession(MANAGER));
    expect(await screen.findByText(/the last ones are cut on every run/)).toHaveTextContent(
      'Agents receive 60,000 of up to 60,000 characters.',
    );
  });

  it('reports when the knowledge base cannot be loaded', async () => {
    stubApi({ 'GET /api/v1/studio/knowledge': () => json(500, {}) });
    renderPage(makeSession(MANAGER));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The knowledge base could not be loaded.',
    );
  });
});
