import {
  type Run,
  runSchema,
  type Screen,
  type SelectedElement,
  sourceEditSchema,
} from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json, TEAM_ID } from '../../test-fixtures';
import { RightPanel } from './right-panel';

const PROJECT_ID = '77777777-7777-4777-8777-777777777777';
const EDIT_PATH = `/api/v1/projects/${PROJECT_ID}/source-edits`;
const REVISION = 12;
const TOKENS = ':root { --color-primary: #0055ff; --color-surface: #ffffff; }';

const selection: SelectedElement = {
  path: 'src/pages/home.tsx',
  line: 14,
  column: 6,
  tag: 'button',
  className: 'flex p-2 text-sm hover:p-4 bg-[var(--color-surface)]',
  text: 'Continue',
  attributes: {},
  rect: { x: 10, y: 20, width: 120.4, height: 39.6 },
  computed: {
    display: 'flex',
    fontSize: '14px',
    fontWeight: '400',
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgb(255, 255, 255)',
  },
};

const screens: Screen[] = [
  {
    pageId: '88888888-8888-4888-8888-888888888888',
    name: 'Home',
    route: '/',
    filePath: 'src/pages/home.tsx',
    code: '<button data-link="/checkout">Continue</button>',
  },
  {
    pageId: '99999999-9999-4999-8999-999999999999',
    name: 'Checkout',
    route: '/checkout',
    filePath: 'src/pages/checkout.tsx',
    code: '<main>Pay</main>',
  },
];

const failedRun: Run = runSchema.parse({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  projectId: PROJECT_ID,
  status: 'failed',
  prompt: 'A checkout flow',
  title: null,
  errorCode: 'rate_limited',
  startedByName: 'Ada Lovelace',
  startedAt: '2026-11-10T10:00:00.000Z',
  finishedAt: '2026-11-10T10:01:00.000Z',
  inputTokens: 1000,
  outputTokens: 234,
  screens: 0,
  reviewScore: null,
  traced: false,
  steps: [],
});

const apiError = (code: string, message: string) => ({
  error: { code, message, correlationId: 'corr-1' },
});

type Handler = (init: RequestInit | undefined) => Response;
function stubApi(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    [`GET /api/v1/projects/${PROJECT_ID}/runs`]: () => json(200, []),
    [`POST ${EDIT_PATH}`]: () => json(200, { revision: REVISION + 1, code: '<button />' }),
    ...overrides,
  };
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${path}`];
    return Promise.resolve(handler ? handler(init) : json(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function editsSent(fetchMock: ReturnType<typeof stubApi>) {
  return fetchMock.mock.calls
    .filter(([path, init]) => path === EDIT_PATH && init?.method === 'POST')
    .map(([, init]) => sourceEditSchema.parse(JSON.parse(init?.body as string)));
}

function renderPanel(props: Partial<Parameters<typeof RightPanel>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setCsrfToken('csrf');
  const onEdited = vi.fn();
  const onPlay = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RightPanel
        projectId={PROJECT_ID}
        teamId={TEAM_ID}
        selection={selection}
        tokensCss={TOKENS}
        screens={screens}
        revision={REVISION}
        canWrite
        onPlay={onPlay}
        onEdited={onEdited}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onEdited, onPlay };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RightPanel design tab', () => {
  it('shows the selected element and its current class groups', () => {
    stubApi();
    renderPanel();
    expect(screen.getByRole('heading', { name: '<button>' })).toBeInTheDocument();
    expect(screen.getByText(/Line 14 · 120×40/)).toBeInTheDocument();
    expect(screen.getByLabelText('Text')).toHaveValue('Continue');
    expect(screen.getByLabelText('Display')).toHaveValue('flex');
    expect(screen.getByLabelText('Padding')).toHaveValue('p-2');
    expect(screen.getByLabelText('Size')).toHaveValue('text-sm');
    expect(screen.getByLabelText('Fill')).toHaveValue('bg-[var(--color-surface)]');
    expect(screen.getByLabelText('All classes')).toHaveValue(selection.className);
  });

  it('saves edited text as a setText edit against the current revision', async () => {
    const fetchMock = stubApi();
    const { onEdited } = renderPanel();
    const text = screen.getByLabelText('Text');
    await userEvent.clear(text);
    await userEvent.type(text, 'Pay now');
    await userEvent.tab();

    await waitFor(() => {
      expect(onEdited).toHaveBeenCalledTimes(1);
    });
    // The whole source before and after the edit, for undo/redo.
    expect(onEdited).toHaveBeenCalledWith({
      pageId: screens[0]?.pageId,
      path: screens[0]?.filePath,
      before: screens[0]?.code,
      after: '<button />',
    });
    expect(editsSent(fetchMock)).toEqual([
      {
        path: selection.path,
        line: 14,
        column: 6,
        baseRevision: REVISION,
        op: { type: 'setText', text: 'Pay now' },
      },
    ]);
    const post = fetchMock.mock.calls.find(([path]) => path === EDIT_PATH);
    expect(new Headers(post?.[1]?.headers).get('x-csrf-token')).toBe('csrf');
  });

  it('does not save text that was not changed', async () => {
    const fetchMock = stubApi();
    renderPanel();
    await userEvent.click(screen.getByLabelText('Text'));
    await userEvent.tab();
    expect(editsSent(fetchMock)).toEqual([]);
  });

  it('replaces one class group and keeps variant-prefixed classes', async () => {
    const fetchMock = stubApi();
    const { onEdited } = renderPanel();
    await userEvent.selectOptions(screen.getByLabelText('Padding'), '24px');

    await waitFor(() => {
      expect(onEdited).toHaveBeenCalled();
    });
    expect(editsSent(fetchMock)).toEqual([
      {
        path: selection.path,
        line: 14,
        column: 6,
        baseRevision: REVISION,
        op: {
          type: 'setClassName',
          className: 'flex text-sm hover:p-4 bg-[var(--color-surface)] p-6',
        },
      },
    ]);
  });

  it('offers design-system colour tokens and removes a group with the empty option', async () => {
    const fetchMock = stubApi();
    renderPanel();
    const fill = screen.getByLabelText('Fill');
    expect(Array.from((fill as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      '',
      'bg-[var(--color-primary)]',
      'bg-[var(--color-surface)]',
    ]);

    await userEvent.selectOptions(screen.getByLabelText('Colour'), 'primary');
    await userEvent.selectOptions(screen.getByLabelText('Display'), '—');

    await waitFor(() => {
      expect(editsSent(fetchMock)).toHaveLength(2);
    });
    const [colour, display] = editsSent(fetchMock);
    expect(colour?.op).toEqual({
      type: 'setClassName',
      className: 'flex p-2 text-sm hover:p-4 bg-[var(--color-surface)] text-[var(--color-primary)]',
    });
    expect(display?.op).toEqual({
      type: 'setClassName',
      className: 'p-2 text-sm hover:p-4 bg-[var(--color-surface)]',
    });
  });

  it('saves the raw class list on blur', async () => {
    const fetchMock = stubApi();
    renderPanel();
    const raw = screen.getByLabelText('All classes');
    await userEvent.clear(raw);
    await userEvent.type(raw, 'grid gap-2');
    await userEvent.tab();
    await waitFor(() => {
      expect(editsSent(fetchMock).map((e) => e.op)).toEqual([
        { type: 'setClassName', className: 'grid gap-2' },
      ]);
    });
  });

  it('shows the API error when an edit is refused as stale', async () => {
    stubApi({
      [`POST ${EDIT_PATH}`]: () =>
        json(
          409,
          apiError('STALE_REVISION', 'The screen changed since you selected it. Select it again.'),
        ),
    });
    const { onEdited } = renderPanel();
    await userEvent.selectOptions(screen.getByLabelText('Padding'), '24px');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The screen changed since you selected it. Select it again.',
    );
    expect(onEdited).not.toHaveBeenCalled();
  });

  it('shows the API error when an edit is unsupported', async () => {
    stubApi({
      [`POST ${EDIT_PATH}`]: () =>
        json(422, apiError('EDIT_UNSUPPORTED', 'This element is generated by an expression.')),
    });
    renderPanel();
    const text = screen.getByLabelText('Text');
    await userEvent.type(text, '!');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This element is generated by an expression.',
    );
  });

  it('shows a status message when the error body is not JSON', async () => {
    stubApi({ [`POST ${EDIT_PATH}`]: () => new Response('nope', { status: 500 }) });
    renderPanel();
    await userEvent.selectOptions(screen.getByLabelText('Padding'), '24px');
    expect(await screen.findByRole('alert')).toHaveTextContent('Request failed with status 500');
  });

  it('is read-only without write access', async () => {
    const fetchMock = stubApi();
    renderPanel({ canWrite: false });
    expect(screen.getByLabelText('Text')).toBeDisabled();
    expect(screen.getByLabelText('Padding')).toBeDisabled();
    expect(screen.getByLabelText('All classes')).toBeDisabled();
    await userEvent.click(screen.getByRole('tab', { name: 'Prototype' }));
    expect(await screen.findByLabelText('Action')).toBeDisabled();
    expect(editsSent(fetchMock)).toEqual([]);
  });
});

describe('RightPanel prototype tab', () => {
  it('sets and clears the data-link attribute', async () => {
    const fetchMock = stubApi();
    renderPanel({ selection: { ...selection, attributes: { 'data-link': '/checkout' } } });
    await userEvent.click(screen.getByRole('tab', { name: 'Prototype' }));
    const onClick = await screen.findByLabelText('Action');
    expect(onClick).toHaveValue('/checkout');
    expect(screen.getByText(/Home → Checkout/)).toBeInTheDocument();

    await userEvent.selectOptions(onClick, 'No action');
    await waitFor(() => {
      expect(editsSent(fetchMock).map((e) => e.op)).toEqual([
        { type: 'setAttribute', name: 'data-link', value: null },
      ]);
    });
  });

  it('links to another screen', async () => {
    const fetchMock = stubApi();
    renderPanel();
    await userEvent.click(screen.getByRole('tab', { name: 'Prototype' }));
    await userEvent.selectOptions(await screen.findByLabelText('Action'), 'Navigate to Checkout');
    await waitFor(() => {
      expect(editsSent(fetchMock)).toEqual([
        {
          path: selection.path,
          line: 14,
          column: 6,
          baseRevision: REVISION,
          op: { type: 'setAttribute', name: 'data-link', value: '/checkout' },
        },
      ]);
    });
  });
});

describe('RightPanel verify tab', () => {
  it('explains the latest failed run', async () => {
    stubApi({ [`GET /api/v1/projects/${PROJECT_ID}/runs`]: () => json(200, [failedRun]) });
    renderPanel();
    await userEvent.click(screen.getByRole('tab', { name: 'Verify' }));
    expect(
      await screen.findByText('The provider is rate limiting the key. Try again shortly.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not traced')).toBeInTheDocument();
  });
});

describe('RightPanel prototype interactions (V7)', () => {
  it('sets trigger, delay, back action and transition as validated attributes', async () => {
    const fetchMock = stubApi();
    renderPanel({
      selection: {
        ...selection,
        attributes: { ...selection.attributes, 'data-link': '/checkout' },
      },
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Prototype' }));
    await userEvent.selectOptions(await screen.findByLabelText('Trigger'), 'After delay');
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'Back');
    await userEvent.selectOptions(screen.getByLabelText('Transition'), 'Dissolve');
    await waitFor(() => {
      expect(editsSent(fetchMock).map((e) => e.op)).toEqual([
        { type: 'setAttribute', name: 'data-trigger', value: 'delay' },
        { type: 'setAttribute', name: 'data-delay', value: '800' },
        { type: 'setAttribute', name: 'data-link', value: 'back' },
        { type: 'setAttribute', name: 'data-transition', value: 'dissolve' },
      ]);
    });
  });

  it('edits the delay of an element whose trigger is "after delay", within limits', async () => {
    const fetchMock = stubApi();
    renderPanel({
      selection: {
        ...selection,
        attributes: { ...selection.attributes, 'data-trigger': 'delay', 'data-delay': '800' },
      },
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Prototype' }));
    const delay = await screen.findByLabelText('Delay (ms)');
    await userEvent.clear(delay);
    await userEvent.type(delay, '99999');
    await userEvent.tab();
    expect(delay).toHaveValue(30000);
    await waitFor(() => {
      expect(editsSent(fetchMock).map((e) => e.op)).toEqual([
        { type: 'setAttribute', name: 'data-delay', value: '30000' },
      ]);
    });
  });

  it('rejects invalid prototype values in the contract', () => {
    const edit = (name: string, value: string) =>
      sourceEditSchema.safeParse({
        path: 'a.tsx',
        line: 1,
        column: 0,
        baseRevision: 1,
        op: { type: 'setAttribute', name, value },
      }).success;
    expect(edit('data-link', 'back')).toBe(true);
    expect(edit('data-link', '/checkout')).toBe(true);
    expect(edit('data-link', 'javascript:alert(1)')).toBe(false);
    expect(edit('data-trigger', 'hover')).toBe(true);
    expect(edit('data-trigger', 'scroll')).toBe(false);
    expect(edit('data-delay', '30001')).toBe(false);
    expect(edit('data-transition', 'slide')).toBe(false);
  });
});
