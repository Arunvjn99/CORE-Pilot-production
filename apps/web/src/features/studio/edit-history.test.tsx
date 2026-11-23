import type { Screen } from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json } from '../../test-fixtures';
import { useEditHistory } from './edit-history';

const PROJECT = '77777777-7777-4777-8777-777777777777';
const PAGE = '88888888-8888-4888-8888-888888888888';
const PATH = 'src/pages/home/HomePage.tsx';
const screen = (code: string): Screen => ({
  pageId: PAGE,
  name: 'Home',
  route: '/',
  filePath: PATH,
  code,
});
const CHANGE = { pageId: PAGE, path: PATH, before: 'A', after: 'B' };

function setup(screens: Screen[], respond: (body: { code: string }) => Response) {
  setCsrfToken('csrf');
  const fetchMock = vi.fn((_path: string, init?: RequestInit) =>
    Promise.resolve(respond(JSON.parse(init?.body as string) as { code: string })),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ list, revision }: { list: Screen[]; revision: number }) =>
      useEditHistory(PROJECT, list, revision),
    { wrapper, initialProps: { list: screens, revision: 5 } },
  );
  return { fetchMock, hook };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useEditHistory', () => {
  it('undoes by writing the previous source with the current revision, then redoes', async () => {
    const { fetchMock, hook } = setup([screen('B')], ({ code }) =>
      json(200, { revision: 6, code }),
    );
    expect(hook.result.current.canUndo).toBe(false);
    act(() => {
      hook.result.current.record(CHANGE);
    });
    expect(hook.result.current.canUndo).toBe(true);
    act(() => {
      hook.result.current.undo();
    });
    await waitFor(() => {
      expect(hook.result.current.canRedo).toBe(true);
    });
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe(`/api/v1/projects/${PROJECT}/screens/${PAGE}/source`);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ code: 'A', baseRevision: 5 });
    expect(hook.result.current.canUndo).toBe(false);

    hook.rerender({ list: [screen('A')], revision: 6 });
    act(() => {
      hook.result.current.redo();
    });
    await waitFor(() => {
      expect(hook.result.current.canUndo).toBe(true);
    });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      code: 'B',
      baseRevision: 6,
    });
  });

  it('refuses to undo over a change made since (AI run or teammate)', () => {
    const { fetchMock, hook } = setup([screen('C')], () => json(200, {}));
    act(() => {
      hook.result.current.record(CHANGE);
    });
    act(() => {
      hook.result.current.undo();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hook.result.current.message).toMatch(/changed since that edit/);
    expect(hook.result.current.canUndo).toBe(false);
  });

  it('clears the history when the server reports a stale revision', async () => {
    const { hook } = setup([screen('B')], () =>
      json(409, { error: { code: 'STALE_REVISION', message: 'Stale', correlationId: 'c' } }),
    );
    act(() => {
      hook.result.current.record(CHANGE);
    });
    act(() => {
      hook.result.current.undo();
    });
    await waitFor(() => {
      expect(hook.result.current.message).toBe(
        'Someone else changed the file, so the history was cleared.',
      );
    });
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it('ignores edits that changed nothing', () => {
    const { hook } = setup([screen('A')], () => json(200, {}));
    act(() => {
      hook.result.current.record({ ...CHANGE, after: 'A' });
    });
    expect(hook.result.current.canUndo).toBe(false);
  });
});
