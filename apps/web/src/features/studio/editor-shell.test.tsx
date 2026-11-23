import { type Project, projectSchema } from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json } from '../../test-fixtures';
import {
  CanvasToolbar,
  type Tool,
  type ToolbarActions,
  useEditorShortcuts,
} from './canvas-toolbar';
import { browserPathOf, FileMenu } from './file-menu';

const FOLDER = 'f0000000-0000-4000-8000-000000000001';
const FILE: Project = projectSchema.parse({
  id: 'a0000000-0000-4000-8000-000000000001',
  name: 'Checkout',
  description: '',
  status: 'active',
  pageCount: 2,
  createdByName: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-22T10:00:00.000Z',
  lastOpenedAt: null,
  folderId: FOLDER,
  folderName: 'Payments',
  designSystemSlug: 'core-2',
});

function stubApi(routes: Record<string, (init?: RequestInit) => Response>) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${path.split('?')[0] ?? ''}`];
    return Promise.resolve(handler ? handler(init) : json(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderMenu(file: Project, canWrite = true) {
  setCsrfToken('csrf');
  const onShowHistory = vi.fn();
  const onOpenSettings = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/file/:id',
        element: (
          <FileMenu
            file={file}
            teamId="team"
            canWrite={canWrite}
            onShowHistory={onShowHistory}
            onOpenSettings={onOpenSettings}
          />
        ),
      },
      { path: '*', element: <p>Elsewhere</p> },
    ],
    { initialEntries: [`/file/${file.id}`] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, onShowHistory, onOpenSettings };
}

const openMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Checkout, file menu' }));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('file menu (breadcrumb)', () => {
  it('links back to the file’s project, Drafts or Trash', () => {
    expect(browserPathOf(FILE)).toBe(`/files/project/${FOLDER}`);
    expect(browserPathOf({ folderId: null, status: 'active' })).toBe('/files/drafts');
    expect(browserPathOf({ folderId: FOLDER, status: 'archived' })).toBe('/files/trash');
    stubApi({ 'GET /api/v1/folders': () => json(200, []) });
    renderMenu(FILE);
    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute(
      'href',
      `/files/project/${FOLDER}`,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Checkout');
  });

  it('renames, opens history and settings, and duplicates into the copy', async () => {
    const copyId = 'a0000000-0000-4000-8000-000000000002';
    const fetchMock = stubApi({
      'GET /api/v1/folders': () => json(200, []),
      [`PATCH /api/v1/projects/${FILE.id}`]: () => json(200, { ...FILE, name: 'Checkout v2' }),
      [`POST /api/v1/projects/${FILE.id}/duplicate`]: () =>
        json(201, { ...FILE, id: copyId, name: 'Checkout (copy)' }),
    });
    const { router, onShowHistory, onOpenSettings } = renderMenu(FILE);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename file' });
    await userEvent.clear(within(dialog).getByLabelText('File name'));
    await userEvent.type(within(dialog).getByLabelText('File name'), 'Checkout v2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(patch?.[1]?.body as string)).toEqual({
      name: 'Checkout v2',
      expectedUpdatedAt: FILE.updatedAt,
    });

    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Version history' }));
    expect(onShowHistory).toHaveBeenCalled();
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'File settings' }));
    expect(onOpenSettings).toHaveBeenCalled();

    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/file/${copyId}`);
    });
  });

  it('moves the file to trash and returns to the Trash view', async () => {
    stubApi({
      'GET /api/v1/folders': () => json(200, []),
      [`PATCH /api/v1/projects/${FILE.id}`]: () => json(200, { ...FILE, status: 'archived' }),
    });
    const { router } = renderMenu(FILE);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to trash' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/files/trash');
    });
  });

  it('offers only read actions without write access', async () => {
    stubApi({ 'GET /api/v1/folders': () => json(200, []) });
    renderMenu(FILE, false);
    await openMenu();
    for (const name of ['Rename', 'Duplicate', 'Move to…'])
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute('data-disabled');
    expect(screen.queryByRole('menuitem', { name: 'Move to trash' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Export React project' })).not.toHaveAttribute(
      'data-disabled',
    );
  });
});

function Harness({
  actions,
  canWrite = true,
}: {
  actions: Partial<ToolbarActions>;
  canWrite?: boolean;
}) {
  const [tool, setTool] = useState<Tool>('move');
  const all: ToolbarActions = {
    setTool,
    addScreen: vi.fn(),
    askAi: vi.fn(),
    fit: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    togglePanels: vi.fn(),
    clearSelection: vi.fn(),
    ...actions,
  };
  useEditorShortcuts(all, tool, canWrite);
  return (
    <>
      <input aria-label="Some field" />
      <CanvasToolbar tool={tool} canWrite={canWrite} actions={all} />
    </>
  );
}

describe('canvas toolbar and shortcuts', () => {
  it('switches tools from the toolbar and the keyboard, with Space as a temporary hand', async () => {
    render(<Harness actions={{}} />);
    const move = screen.getByRole('button', { name: 'Move (V)' });
    const hand = screen.getByRole('button', { name: 'Hand (H)' });
    expect(move).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(hand);
    expect(hand).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('v');
    expect(move).toHaveAttribute('aria-pressed', 'true');
    // One user instance, so the Space release belongs to the same key press.
    const user = userEvent.setup();
    await user.keyboard('[Space>]');
    expect(hand).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('[/Space]');
    expect(move).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('c');
    expect(screen.getByRole('button', { name: 'Comment (C)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('runs actions from shortcuts but never while typing in a field', async () => {
    const actions = {
      addScreen: vi.fn(),
      askAi: vi.fn(),
      fit: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      togglePanels: vi.fn(),
      clearSelection: vi.fn(),
    };
    render(<Harness actions={actions} />);
    await userEvent.keyboard(
      's/{Shift>}!{/Shift}{Control>}={/Control}{Control>}-{/Control}{Control>}\\{/Control}{Escape}',
    );
    expect(actions.addScreen).toHaveBeenCalledTimes(1);
    expect(actions.askAi).toHaveBeenCalledTimes(1);
    expect(actions.fit).toHaveBeenCalledTimes(1);
    expect(actions.zoomIn).toHaveBeenCalledTimes(1);
    expect(actions.zoomOut).toHaveBeenCalledTimes(1);
    expect(actions.togglePanels).toHaveBeenCalledTimes(1);
    expect(actions.clearSelection).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('textbox', { name: 'Some field' }));
    await userEvent.keyboard('s/');
    expect(actions.addScreen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Some field' })).toHaveValue('s/');
  });

  it('disables editing tools for viewers', async () => {
    const addScreen = vi.fn();
    render(<Harness actions={{ addScreen }} canWrite={false} />);
    expect(screen.getByRole('button', { name: 'Add screen (S)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Comment (C)' })).toBeDisabled();
    await userEvent.keyboard('s');
    expect(addScreen).not.toHaveBeenCalled();
  });
});
