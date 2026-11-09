import { type Project, type ProjectPage, routeFromName } from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { applyTheme, setTheme } from '../../lib/theme';
import { json, makeSession } from '../../test-fixtures';
import { SESSION_QUERY_KEY } from '../auth/use-session';
import { ProjectDashboard, timeAgo } from './project-dashboard';
import { WorkspaceRoute } from './workspace/workspace-layout';

const PROJECT_ID = '77777777-7777-4777-8777-777777777777';
const HOME_ID = '88888888-8888-4888-8888-888888888888';
const PRICING_ID = '99999999-9999-4999-8999-999999999999';
const now = new Date().toISOString();

const project: Project = {
  id: PROJECT_ID,
  name: 'Checkout',
  description: 'New checkout flow',
  status: 'active',
  pageCount: 2,
  createdByName: 'Ada Lovelace',
  createdAt: now,
  updatedAt: now,
  lastOpenedAt: now,
};
const page = (id: string, name: string, route: string, position: number): ProjectPage => ({
  id,
  projectId: PROJECT_ID,
  name,
  route,
  position,
  filePath: null,
  createdAt: now,
  updatedAt: now,
});
const pages = [page(HOME_ID, 'Home', '/', 0), page(PRICING_ID, 'Pricing', '/pricing', 1)];

const WRITER = makeSession({
  permissions: ['members:read', 'projects:read', 'projects:write', 'providers:read'],
});
const VIEWER = makeSession({ permissions: ['projects:read'] });

type Handler = (init: RequestInit | undefined) => Response;
function stubApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${path}`];
    return Promise.resolve(
      handler
        ? handler(init)
        : json(404, { error: { code: 'NOT_FOUND', message: 'Not found', correlationId: 'c' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string, session = WRITER) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(SESSION_QUERY_KEY, session);
  setCsrfToken('csrf');
  const router = createMemoryRouter(
    [
      { path: '/projects', element: <ProjectDashboard /> },
      { path: '/projects/:projectId/:section?', element: <WorkspaceRoute /> },
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

const workspaceRoutes = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  [`GET /api/v1/projects/${PROJECT_ID}`]: () => json(200, project),
  [`GET /api/v1/projects/${PROJECT_ID}/pages`]: () => json(200, pages),
  [`POST /api/v1/projects/${PROJECT_ID}/open`]: () => json(200, project),
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('helpers', () => {
  it('suggests routes from page names', () => {
    expect(routeFromName('Getting Started')).toBe('/getting-started');
    expect(routeFromName('  Café & Bar!! ')).toBe('/cafe-bar');
    expect(routeFromName('???')).toBe('/');
  });
  it('formats relative times', () => {
    const base = Date.parse('2026-11-09T12:00:00Z');
    expect(timeAgo('2026-11-09T11:59:50Z', base)).toBe('just now');
    expect(timeAgo('2026-11-09T09:00:00Z', base)).toBe('3 hours ago');
  });
  it('applies the theme preference to the document', () => {
    setTheme('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    setTheme('system');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    applyTheme('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    setTheme('system');
  });
});

describe('ProjectDashboard', () => {
  it('shows an empty state that matches the role', async () => {
    stubApi({
      'GET /api/v1/projects?status=active': () => json(200, []),
      'GET /api/v1/projects?status=archived': () => json(200, []),
    });
    renderAt('/projects', VIEWER);
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New project' })).toBeNull();
  });

  it('lists project cards with status, pages and recent projects', async () => {
    stubApi({
      'GET /api/v1/projects?status=active': () => json(200, [project]),
      'GET /api/v1/projects?status=archived': () => json(200, []),
    });
    renderAt('/projects');
    const card = await screen.findByRole('listitem', { name: 'Checkout' });
    expect(within(card).getByText('Active')).toBeInTheDocument();
    expect(within(card).getByText('2 pages')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Checkout' })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}/canvas`,
    );
    expect(screen.getByRole('heading', { name: 'Recently opened' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search projects'), 'zzz');
    expect(screen.getByText('No projects match “zzz”.')).toBeInTheDocument();
  });

  it('creates a project and opens its workspace', async () => {
    let body: unknown;
    stubApi({
      'GET /api/v1/projects?status=active': () => json(200, []),
      'GET /api/v1/projects?status=archived': () => json(200, []),
      'POST /api/v1/projects': (init) => {
        body = JSON.parse(init?.body as string);
        return json(201, project);
      },
      ...workspaceRoutes(),
    });
    const router = renderAt('/projects');
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    await userEvent.type(within(dialog).getByLabelText('Project name'), ' Checkout ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/projects/${PROJECT_ID}/canvas`);
    });
    expect(body).toEqual({ name: 'Checkout', description: '' });
  });

  it('archives from the card menu with the concurrency token', async () => {
    let body: unknown;
    stubApi({
      'GET /api/v1/projects?status=active': () => json(200, [project]),
      'GET /api/v1/projects?status=archived': () => json(200, []),
      [`PATCH /api/v1/projects/${PROJECT_ID}`]: (init) => {
        body = JSON.parse(init?.body as string);
        return json(200, { ...project, status: 'archived' });
      },
    });
    renderAt('/projects');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Checkout' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => {
      expect(body).toEqual({ status: 'archived', expectedUpdatedAt: now });
    });
  });
});

describe('Workspace', () => {
  it('shows sections, pages and the selected page', async () => {
    const fetchMock = stubApi(workspaceRoutes());
    renderAt(`/projects/${PROJECT_ID}/canvas?page=${PRICING_ID}`);
    expect(await screen.findByRole('heading', { name: 'Checkout', level: 1 })).toBeInTheDocument();
    const nav = screen.getAllByRole('navigation', { name: 'Workspace' })[0] as HTMLElement;
    for (const label of [
      'Visual canvas',
      'Code editor',
      'AI assistant',
      'Design system',
      'Project settings',
    ])
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Pricing', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pricing/, current: 'page' })).toBeInTheDocument();
    expect(screen.getByText('Not available yet · slices 2.6–2.7')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'AI assistant' })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/projects/${PROJECT_ID}/open`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('moves between pages with the arrow keys', async () => {
    stubApi(workspaceRoutes());
    renderAt(`/projects/${PROJECT_ID}/canvas`);
    const home = await screen.findByRole('link', { name: /Home/ });
    home.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: /Pricing/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(home).toHaveFocus();
  });

  it('adds a page with a suggested route', async () => {
    let body: unknown;
    stubApi(
      workspaceRoutes({
        [`POST /api/v1/projects/${PROJECT_ID}/pages`]: (init) => {
          body = JSON.parse(init?.body as string);
          return json(
            201,
            page('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'About Us', '/about-us', 2),
          );
        },
      }),
    );
    renderAt(`/projects/${PROJECT_ID}/canvas`);
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Add page' }))[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add page' });
    await userEvent.type(within(dialog).getByLabelText('Page name'), 'About Us');
    expect(within(dialog).getByLabelText('Route')).toHaveValue('/about-us');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add page' }));
    await waitFor(() => {
      expect(body).toEqual({ name: 'About Us', route: '/about-us' });
    });
  });

  it('asks for confirmation before deleting a page', async () => {
    const remove = vi.fn(() => new Response(null, { status: 204 }));
    stubApi(
      workspaceRoutes({ [`DELETE /api/v1/projects/${PROJECT_ID}/pages/${PRICING_ID}`]: remove }),
    );
    renderAt(`/projects/${PROJECT_ID}/canvas`);
    await userEvent.click(
      (
        await screen.findAllByRole('button', { name: 'Actions for page Pricing' })
      )[0] as HTMLElement,
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete page “Pricing”?' });
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete page' }));
    await waitFor(() => {
      expect(remove).toHaveBeenCalled();
    });
  });

  it('is read-only for viewers and for archived projects', async () => {
    stubApi(workspaceRoutes());
    renderAt(`/projects/${PROJECT_ID}/canvas`, VIEWER);
    await screen.findByRole('link', { name: /Pricing/ });
    expect(screen.queryByRole('button', { name: 'Add page' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for page/ })).toBeNull();
  });

  it('shows archived projects as read-only', async () => {
    stubApi(
      workspaceRoutes({
        [`GET /api/v1/projects/${PROJECT_ID}`]: () => json(200, { ...project, status: 'archived' }),
        [`POST /api/v1/projects/${PROJECT_ID}/open`]: () =>
          json(200, { ...project, status: 'archived' }),
      }),
    );
    renderAt(`/projects/${PROJECT_ID}/canvas`);
    expect(await screen.findByText('Archived · read-only')).toBeInTheDocument();
    await screen.findByRole('link', { name: /Pricing/ });
    expect(screen.queryByRole('button', { name: 'Add page' })).toBeNull();
  });

  it('edits project details in Project settings', async () => {
    let body: unknown;
    stubApi(
      workspaceRoutes({
        [`PATCH /api/v1/projects/${PROJECT_ID}`]: (init) => {
          body = JSON.parse(init?.body as string);
          return json(200, { ...project, name: 'Checkout 2' });
        },
      }),
    );
    renderAt(`/projects/${PROJECT_ID}/settings`);
    expect(await screen.findByRole('heading', { name: 'General' })).toBeInTheDocument();
    const nameInput = screen.getByLabelText('Project name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Checkout 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(body).toEqual({
        name: 'Checkout 2',
        description: 'New checkout flow',
        expectedUpdatedAt: now,
      });
    });
    expect(screen.getByRole('button', { name: 'Archive project' })).toBeInTheDocument();
  });

  it('explains a missing project', async () => {
    stubApi({});
    renderAt(`/projects/${PROJECT_ID}/canvas`);
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument();
  });
});
