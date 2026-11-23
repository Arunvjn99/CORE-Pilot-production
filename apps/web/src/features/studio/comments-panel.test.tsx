import { type CommentThread, type Screen, commentThreadSchema } from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json } from '../../test-fixtures';
import { CommentsPanel, type PendingPin } from './comments-panel';

const PROJECT = '77777777-7777-4777-8777-777777777777';
const PAGE = '88888888-8888-4888-8888-888888888888';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BASE = `/api/v1/projects/${PROJECT}/comments`;
const SCREENS: Screen[] = [
  { pageId: PAGE, name: 'Sign in', route: '/', filePath: 'a.tsx', code: '' },
];

const thread = (id: string, body: string, authorId: string, extra: Partial<CommentThread> = {}) =>
  commentThreadSchema.parse({
    id,
    projectId: PROJECT,
    pageId: PAGE,
    x: 0.5,
    y: 0.25,
    body,
    authorId,
    authorName: authorId === ME ? 'Ada Lovelace' : 'Grace Hopper',
    edited: false,
    resolvedAt: null,
    resolvedById: null,
    resolvedByName: null,
    createdAt: '2026-11-23T10:00:00.000Z',
    updatedAt: '2026-11-23T10:00:00.000Z',
    replies: [],
    ...extra,
  });
const MINE = thread('c0000000-0000-4000-8000-000000000001', 'Make the button bigger', ME);
const THEIRS = thread('c0000000-0000-4000-8000-000000000002', 'Use the brand blue', OTHER, {
  replies: [
    {
      id: 'c0000000-0000-4000-8000-000000000003',
      parentId: 'c0000000-0000-4000-8000-000000000002',
      body: 'Agreed',
      authorId: ME,
      authorName: 'Ada Lovelace',
      edited: false,
      createdAt: '2026-11-23T10:05:00.000Z',
      updatedAt: '2026-11-23T10:05:00.000Z',
    },
  ],
});

function setup(
  props: Partial<{ canWrite: boolean; canModerate: boolean; pendingPin: PendingPin | null }> = {},
) {
  setCsrfToken('csrf');
  const fetchMock = vi.fn((_path: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, MINE),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const onCancelPin = vi.fn();
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CommentsPanel
        projectId={PROJECT}
        threads={[MINE, THEIRS]}
        screens={SCREENS}
        userId={ME}
        canWrite={props.canWrite ?? true}
        canModerate={props.canModerate ?? false}
        includeResolved={false}
        onIncludeResolved={vi.fn()}
        pendingPin={props.pendingPin ?? null}
        onCancelPin={onCancelPin}
        activeId={null}
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  );
  const sent = (method: string) =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === method)
      .map(([path, init]) => ({
        path,
        body: init?.body ? (JSON.parse(init.body as string) as unknown) : null,
      }));
  return { sent, onCancelPin, onSelect };
}

const item = (text: RegExp) => screen.getByRole('listitem', { name: text });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CommentsPanel', () => {
  it('lists numbered threads with their screen, author and replies', () => {
    setup();
    const mine = item(/Make the button bigger/);
    expect(within(mine).getByText('1')).toBeVisible();
    expect(mine).toHaveTextContent('Sign in');
    expect(mine).toHaveTextContent('Ada Lovelace');
    const theirs = item(/Use the brand blue/);
    expect(within(theirs).getByText('2')).toBeVisible();
    expect(theirs).toHaveTextContent('Agreed');
  });

  it('posts a pinned comment at the chosen spot, and file-level comments', async () => {
    const { sent, onCancelPin, onSelect } = setup({ pendingPin: { pageId: PAGE, x: 0.1, y: 0.9 } });
    expect(screen.getByText('New comment on Sign in')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Add a comment'), 'Too much padding');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      expect(onCancelPin).toHaveBeenCalled();
    });
    expect(onSelect).toHaveBeenCalledWith(MINE.id);
    expect(sent('POST')[0]).toEqual({
      path: BASE,
      body: { pageId: PAGE, x: 0.1, y: 0.9, body: 'Too much padding' },
    });
  });

  it('replies, resolves and edits only the author’s own comment', async () => {
    const { sent } = setup();
    const theirs = item(/Use the brand blue/);
    expect(within(theirs).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(theirs).queryByRole('button', { name: 'Delete thread' })).toBeNull();
    await userEvent.type(within(theirs).getByLabelText('Reply'), 'Done in v2');
    await userEvent.click(within(theirs).getByRole('button', { name: 'Reply' }));
    await userEvent.click(within(theirs).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => {
      expect(sent('POST').map((c) => c.path)).toEqual([
        `${BASE}/${THEIRS.id}/replies`,
        `${BASE}/${THEIRS.id}/resolve`,
      ]);
    });
    expect(sent('POST')[0]?.body).toEqual({ body: 'Done in v2' });

    const mine = item(/Make the button bigger/);
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    const edit = within(mine).getByLabelText('Edit comment');
    await userEvent.clear(edit);
    await userEvent.type(edit, 'Make the button 48px');
    await userEvent.click(within(mine).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(sent('PATCH')[0]).toEqual({
        path: `${BASE}/${MINE.id}`,
        body: { body: 'Make the button 48px' },
      });
    });
    await userEvent.click(within(mine).getByRole('button', { name: 'Delete thread' }));
    await waitFor(() => {
      expect(sent('DELETE')[0]?.path).toBe(`${BASE}/${MINE.id}`);
    });
  });

  it('lets moderators delete anyone’s thread', () => {
    setup({ canModerate: true });
    expect(
      within(item(/Use the brand blue/)).getByRole('button', { name: 'Delete thread' }),
    ).toBeVisible();
  });

  it('is read-only without write access', () => {
    setup({ canWrite: false });
    expect(screen.queryByLabelText('Comment on the whole file')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.queryByLabelText('Reply')).toBeNull();
  });
});
