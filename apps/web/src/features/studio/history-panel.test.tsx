import { type Checkpoint, checkpointSchema } from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json } from '../../test-fixtures';
import { HistoryPanel } from './history-panel';

const PROJECT_ID = '77777777-7777-4777-8777-777777777777';
const BASE = `/api/v1/projects/${PROJECT_ID}`;

const checkpoint = (id: string, message: string, kind: Checkpoint['kind'], minutes: number) =>
  checkpointSchema.parse({
    id,
    commitSha: id.replaceAll('-', '').padEnd(40, '0').slice(0, 40),
    message,
    kind,
    revision: minutes,
    restoredFrom: null,
    authorName: 'Ada Lovelace',
    createdAt: new Date(Date.UTC(2026, 10, 17, 10, minutes)).toISOString(),
  });

const LATEST = checkpoint('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'AI: Account area', 'manual', 30);
const OLDER = checkpoint('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Project created', 'create', 0);

type Handler = (init: RequestInit | undefined) => Response;
function stubApi(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    [`GET ${BASE}/checkpoints`]: () => json(200, [LATEST, OLDER]),
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
  setCsrfToken('csrf');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HistoryPanel projectId={PROJECT_ID} canWrite={canWrite} />
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HistoryPanel', () => {
  it('lists checkpoints newest first with download links for the work and each checkpoint', async () => {
    stubApi();
    renderPanel();
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('aria-label'))).toEqual([
      'AI: Account area',
      'Project created',
    ]);
    expect(items[0]).toHaveTextContent(/Saved · .* · Ada Lovelace · latest/);
    expect(items[1]).toHaveTextContent('Created');
    expect(
      screen.getByRole('link', { name: 'Export current work (React project)' }),
    ).toHaveAttribute('href', `${BASE}/export`);
    expect(screen.getByRole('link', { name: 'Download “Project created”' })).toHaveAttribute(
      'href',
      `${BASE}/export?checkpointId=${OLDER.id}`,
    );
  });

  it('restores a checkpoint after confirmation, keeping unsaved work', async () => {
    const fetchMock = stubApi({
      [`POST ${BASE}/checkpoints/${OLDER.id}/restore`]: () =>
        json(200, checkpoint('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Restore', 'restore', 40)),
    });
    const client = renderPanel();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    // Every checkpoint can be restored; the latest one undoes unsaved edits.
    await screen.findByRole('button', { name: 'Restore “Project created”' });
    expect(screen.getByRole('button', { name: 'Restore “AI: Account area”' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Restore “Project created”' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Restore “Project created”?' });
    expect(dialog).toHaveTextContent('Unsaved work is kept as an automatic checkpoint');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(call?.[0]).toBe(`${BASE}/checkpoints/${OLDER.id}/restore`);
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({ safetyCheckpoint: true });
    expect(new Headers(call?.[1]?.headers).get('x-csrf-token')).toBe('csrf');
    const refreshed = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(refreshed).toEqual(
      expect.arrayContaining([
        JSON.stringify(['studio', 'screens', PROJECT_ID]),
        JSON.stringify(['studio', 'checkpoints', PROJECT_ID]),
        JSON.stringify(['projects']),
      ]),
    );
  });

  it('shows why a restore was refused and keeps the dialog open', async () => {
    stubApi({
      [`POST ${BASE}/checkpoints/${OLDER.id}/restore`]: () =>
        json(409, {
          error: {
            code: 'PROJECT_ARCHIVED',
            message: 'Restore the project before changing it.',
            correlationId: 'c',
          },
        }),
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Restore “Project created”' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }),
    );
    expect(await screen.findByText('Restore the project before changing it.')).toBeVisible();
    expect(screen.getByRole('alertdialog')).toBeVisible();
  });

  it('is read-only without write access, and explains an empty history', async () => {
    stubApi();
    renderPanel(false);
    await screen.findAllByRole('listitem');
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Download “Project created”' })).toBeVisible();

    vi.unstubAllGlobals();
    stubApi({ [`GET ${BASE}/checkpoints`]: () => json(200, []) });
    renderPanel();
    expect(await screen.findByText('No checkpoints yet')).toBeVisible();
  });
});
