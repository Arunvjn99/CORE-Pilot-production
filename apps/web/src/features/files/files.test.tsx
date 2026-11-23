import { type Folder, type Project, folderSchema, projectSchema } from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json, makeSession } from '../../test-fixtures';
import { SESSION_QUERY_KEY } from '../auth/use-session';
import { FilesLayout } from './files-layout';
import { FilesView } from './files-view';

const PAYMENTS = folderSchema.parse({
  id: 'f0000000-0000-4000-8000-000000000001',
  name: 'Payments',
  fileCount: 1,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
});
const file = (
  id: string,
  name: string,
  folder: Folder | null,
  status: 'active' | 'archived' = 'active',
): Project =>
  projectSchema.parse({
    id,
    name,
    description: '',
    status,
    pageCount: 2,
    createdByName: 'Ada Lovelace',
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    lastOpenedAt: '2026-11-22T10:00:00.000Z',
    folderId: folder?.id ?? null,
    folderName: folder?.name ?? null,
    designSystemSlug: 'core-2',
  });
const CHECKOUT = file('a0000000-0000-4000-8000-000000000001', 'Checkout', PAYMENTS);
const SCRATCH = file('a0000000-0000-4000-8000-000000000002', 'Scratch', null);
const OLD = file('a0000000-0000-4000-8000-000000000003', 'Old idea', null, 'archived');

const DESIGNER = makeSession({
  permissions: ['projects:read', 'projects:write', 'members:read', 'providers:read'],
});
const VIEWER = makeSession({ permissions: ['projects:read'] });

type Handler = (init: RequestInit | undefined, url: URL) => Response;
function stubApi(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    'GET /api/v1/folders': () => json(200, [PAYMENTS]),
    'GET /api/v1/projects': (_init, url) =>
      json(
        200,
        url.searchParams.get('status') === 'archived'
          ? [OLD]
          : url.searchParams.get('folder') === 'drafts'
            ? [SCRATCH]
            : url.searchParams.get('folder') === PAYMENTS.id
              ? [CHECKOUT]
              : [CHECKOUT, SCRATCH].filter((f) =>
                  f.name.toLowerCase().includes((url.searchParams.get('q') ?? '').toLowerCase()),
                ),
      ),
    'GET /api/v1/studio/design-systems': () =>
      json(200, [
        { slug: 'core-2', name: 'CORE 2.0', version: 0, custom: false, customized: false },
        { slug: 'minimal', name: 'Minimal', version: 0, custom: false, customized: false },
      ]),
    ...overrides,
  };
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const url = new URL(path, 'http://studio.test');
    const handler = routes[`${init?.method ?? 'GET'} ${url.pathname}`];
    return Promise.resolve(handler ? handler(init, url) : json(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stubApi>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(([p, init]) => (init?.method ?? 'GET') === method && p.startsWith(path))
    .map(([p, init]) => ({
      path: p,
      body: init?.body ? (JSON.parse(init.body as string) as unknown) : null,
    }));

function renderAt(path: string, session = DESIGNER) {
  setCsrfToken('csrf');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(SESSION_QUERY_KEY, session);
  const router = createMemoryRouter(
    [
      {
        path: '/files',
        element: <FilesLayout />,
        children: [
          { path: 'recent', element: <FilesView mode="recent" /> },
          { path: 'drafts', element: <FilesView mode="drafts" /> },
          { path: 'project/:folderId', element: <FilesView key="p" mode="project" /> },
          { path: 'trash', element: <FilesView mode="trash" /> },
        ],
      },
      { path: '/file/:id', element: <p>Editor</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const card = (name: string) => screen.findByRole('listitem', { name });
const openMenu = async (name: string) => {
  await userEvent.click(
    within(await card(name)).getByRole('button', { name: `Actions for ${name}` }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('file browser', () => {
  it('shows Recents, Drafts, projects with file counts and Trash', async () => {
    const fetchMock = stubApi();
    renderAt('/files/recent');
    expect(await screen.findByRole('heading', { name: 'Recents', level: 1 })).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Files navigation' });
    for (const label of ['Recents', 'Drafts', 'Trash'])
      expect(within(nav).getByRole('link', { name: label })).toBeVisible();
    expect(await within(nav).findByRole('link', { name: /Payments/ })).toHaveAttribute(
      'href',
      `/files/project/${PAYMENTS.id}`,
    );
    expect(within(nav).getByLabelText('1 files')).toBeVisible();
    expect(await card('Checkout')).toHaveTextContent('Payments · 2 screens');
    expect(await card('Scratch')).toHaveTextContent('Drafts');
    expect(calls(fetchMock, 'GET', '/api/v1/projects')[0]?.path).toContain('sort=opened');
  });

  it('searches, sorts and switches between grid and list', async () => {
    const fetchMock = stubApi();
    renderAt('/files/recent');
    await card('Checkout');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search files' }), 'scr');
    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: 'Checkout' })).toBeNull();
    });
    expect(calls(fetchMock, 'GET', '/api/v1/projects').at(-1)?.path).toContain('q=scr');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'name');
    await waitFor(() => {
      expect(calls(fetchMock, 'GET', '/api/v1/projects').at(-1)?.path).toContain('sort=name');
    });
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('core.files.layout')).toBe('list');
  });

  it('creates a design file in a project with a chosen design system and opens it', async () => {
    const created = file('a0000000-0000-4000-8000-000000000009', 'Loans', PAYMENTS);
    const fetchMock = stubApi({
      'POST /api/v1/projects': () => json(201, created),
      [`POST /api/v1/projects/${created.id}/design/apply`]: () =>
        json(200, { designSystemSlug: 'minimal', designMd: '#', tokensCss: '', revision: 2 }),
    });
    const router = renderAt(`/files/project/${PAYMENTS.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'New design file' }));
    const dialog = screen.getByRole('dialog', { name: 'New design file' });
    await userEvent.type(within(dialog).getByLabelText('File name'), 'Loans');
    expect(within(dialog).getByLabelText('Project')).toHaveValue(PAYMENTS.id);
    await within(dialog).findByRole('option', { name: 'Minimal' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Design system'), 'minimal');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create file' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/file/${created.id}`);
    });
    expect(calls(fetchMock, 'POST', '/api/v1/projects')[0]?.body).toEqual({
      name: 'Loans',
      description: '',
      folderId: PAYMENTS.id,
    });
    expect(
      calls(fetchMock, 'POST', `/api/v1/projects/${created.id}/design/apply`)[0]?.body,
    ).toEqual({
      slug: 'minimal',
    });
  });

  it('renames, duplicates and moves a file from its menu', async () => {
    const fetchMock = stubApi({
      [`PATCH /api/v1/projects/${CHECKOUT.id}`]: (init) =>
        json(200, { ...CHECKOUT, ...(JSON.parse(init?.body as string) as object) }),
      [`POST /api/v1/projects/${CHECKOUT.id}/duplicate`]: () =>
        json(201, {
          ...CHECKOUT,
          id: 'a0000000-0000-4000-8000-00000000000a',
          name: 'Checkout (copy)',
        }),
    });
    renderAt('/files/recent');
    await openMenu('Checkout');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const rename = screen.getByRole('dialog', { name: 'Rename file' });
    await userEvent.clear(within(rename).getByLabelText('File name'));
    await userEvent.type(within(rename).getByLabelText('File name'), 'Checkout v2');
    await userEvent.click(within(rename).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls(fetchMock, 'PATCH', `/api/v1/projects/${CHECKOUT.id}`)[0]?.body).toEqual({
      name: 'Checkout v2',
      expectedUpdatedAt: CHECKOUT.updatedAt,
    });

    await openMenu('Checkout');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(await screen.findByText('Duplicated as “Checkout (copy)”.')).toBeVisible();

    await openMenu('Checkout');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    const move = screen.getByRole('dialog', { name: 'Move “Checkout”' });
    expect(within(move).getByLabelText('Project')).toHaveValue(PAYMENTS.id);
    await userEvent.selectOptions(within(move).getByLabelText('Project'), 'Drafts');
    await userEvent.click(within(move).getByRole('button', { name: 'Move' }));
    await waitFor(() => {
      expect(calls(fetchMock, 'PATCH', `/api/v1/projects/${CHECKOUT.id}`)[1]?.body).toEqual({
        folderId: null,
        expectedUpdatedAt: CHECKOUT.updatedAt,
      });
    });
  });

  it('moves a file to trash with Undo, also with the Delete key; F2 renames', async () => {
    const fetchMock = stubApi({
      [`PATCH /api/v1/projects/${SCRATCH.id}`]: (init) =>
        json(200, { ...SCRATCH, ...(JSON.parse(init?.body as string) as object) }),
    });
    renderAt('/files/drafts');
    await openMenu('Scratch');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to trash' }));
    expect(await screen.findByText(/“Scratch” moved to trash/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(
        calls(fetchMock, 'PATCH', `/api/v1/projects/${SCRATCH.id}`).map((c) => c.body),
      ).toEqual([
        { status: 'archived', expectedUpdatedAt: SCRATCH.updatedAt },
        { status: 'active', expectedUpdatedAt: SCRATCH.updatedAt },
      ]);
    });

    const link = within(await card('Scratch')).getByRole('link', { name: 'Scratch' });
    link.focus();
    await userEvent.keyboard('{F2}');
    expect(screen.getByRole('dialog', { name: 'Rename file' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    link.focus();
    await userEvent.keyboard('{Delete}');
    await waitFor(() => {
      expect(calls(fetchMock, 'PATCH', `/api/v1/projects/${SCRATCH.id}`)).toHaveLength(3);
    });
  });

  it('restores from Trash, which offers nothing else', async () => {
    const fetchMock = stubApi({
      [`PATCH /api/v1/projects/${OLD.id}`]: () => json(200, { ...OLD, status: 'active' }),
    });
    renderAt('/files/trash');
    expect(await screen.findByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'New design file' })).toBeNull();
    expect(within(await card('Old idea')).queryByRole('link')).toBeNull();
    await openMenu('Old idea');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Restore']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
    expect(await screen.findByText('“Old idea” restored.')).toBeVisible();
    expect(calls(fetchMock, 'PATCH', `/api/v1/projects/${OLD.id}`)[0]?.body).toEqual({
      status: 'active',
      expectedUpdatedAt: OLD.updatedAt,
    });
  });

  it('lets team admins delete a file forever or empty Trash, after confirmation', async () => {
    const ADMIN = makeSession({
      permissions: ['projects:read', 'projects:write', 'projects:delete', 'members:read'],
    });
    const fetchMock = stubApi({
      [`DELETE /api/v1/projects/${OLD.id}`]: () => new Response(null, { status: 204 }),
      'DELETE /api/v1/projects/trash': () => json(200, { deleted: 1 }),
    });
    renderAt('/files/trash', ADMIN);
    await openMenu('Old idea');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Restore',
      'Delete forever',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete forever' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete “Old idea” forever?' });
    expect(confirm).toHaveTextContent('This can’t be undone.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete forever' }));
    expect(await screen.findByText('“Old idea” deleted forever.')).toBeVisible();
    expect(calls(fetchMock, 'DELETE', `/api/v1/projects/${OLD.id}`)).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    const empty = screen.getByRole('alertdialog', { name: 'Empty trash?' });
    await userEvent.click(within(empty).getByRole('button', { name: 'Empty trash' }));
    expect(await screen.findByText('1 file deleted forever.')).toBeVisible();
    expect(calls(fetchMock, 'DELETE', '/api/v1/projects/trash')).toHaveLength(1);
  });

  it('hides permanent deletion from designers', async () => {
    stubApi();
    renderAt('/files/trash');
    await card('Old idea');
    expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
  });

  it('creates, renames and deletes projects from the sidebar', async () => {
    const LOANS = {
      ...PAYMENTS,
      id: 'f0000000-0000-4000-8000-000000000002',
      name: 'Loans',
      fileCount: 0,
    };
    const fetchMock = stubApi({
      'POST /api/v1/folders': () => json(201, LOANS),
      [`PATCH /api/v1/folders/${PAYMENTS.id}`]: () =>
        json(200, { ...PAYMENTS, name: 'Payments 2027' }),
      [`DELETE /api/v1/folders/${PAYMENTS.id}`]: () => json(200, { trashedFiles: 1 }),
    });
    const router = renderAt('/files/recent');
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const create = screen.getByRole('dialog', { name: 'New project' });
    await userEvent.type(within(create).getByLabelText('Project name'), 'Loans');
    await userEvent.click(within(create).getByRole('button', { name: 'Create project' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/files/project/${LOANS.id}`);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Actions for project Payments' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const rename = screen.getByRole('dialog', { name: 'Rename project' });
    await userEvent.clear(within(rename).getByLabelText('Project name'));
    await userEvent.type(within(rename).getByLabelText('Project name'), 'Payments 2027');
    await userEvent.click(within(rename).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls(fetchMock, 'PATCH', `/api/v1/folders/${PAYMENTS.id}`)[0]?.body).toEqual({
        name: 'Payments 2027',
      });
    });

    await userEvent.click(screen.getByRole('button', { name: 'Actions for project Payments' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete project “Payments”?' });
    expect(confirm).toHaveTextContent('Its 1 file moves to Trash');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete project' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/files/trash');
    });
  });

  it('is read-only for viewers', async () => {
    stubApi();
    renderAt('/files/recent', VIEWER);
    await openMenu('Checkout');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Export']);
    expect(screen.queryByRole('button', { name: 'New design file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New project' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for project Payments' })).toBeNull();
  });
});
