import {
  type FromPreview,
  fromPreviewSchema,
  PREVIEW_PROTOCOL,
  type SelectedElement,
  toPreviewSchema,
} from '@core-studio/contracts';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewFrame } from './preview-frame';

const ORIGIN = 'https://preview.studio.test';
const PATH = 'src/pages/home.tsx';
const CODE = 'export default function Home() { return <h1>Hi</h1>; }';
const TOKENS = ':root { --color-primary: #0055ff; }';

const element: SelectedElement = {
  path: PATH,
  line: 3,
  column: 10,
  tag: 'h1',
  className: 'text-2xl font-bold',
  text: 'Hi',
  attributes: {},
  rect: { x: 0, y: 0, width: 200, height: 40 },
  computed: {
    display: 'block',
    fontSize: '24px',
    fontWeight: '700',
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
  },
};

function renderFrame(props: Partial<Parameters<typeof PreviewFrame>[0]> = {}) {
  const onSelect = vi.fn();
  const onNavigate = vi.fn();
  const onError = vi.fn();
  const utils = render(
    <PreviewFrame
      previewOrigin={ORIGIN}
      path={PATH}
      code={CODE}
      tokensCss={TOKENS}
      mode="design"
      title="Home"
      width={390}
      height={844}
      onSelect={onSelect}
      onNavigate={onNavigate}
      onError={onError}
      {...props}
    />,
  );
  const iframe = screen.getByTitle<HTMLIFrameElement>('Home');
  const win = iframe.contentWindow;
  if (!win) throw new Error('iframe has no contentWindow');
  const postMessage = vi.spyOn(win, 'postMessage').mockImplementation(() => undefined);
  return { ...utils, iframe, win, postMessage, onSelect, onNavigate, onError };
}

function dispatch(data: unknown, origin: string, source: Window | null) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  });
}

const ready: FromPreview = { type: 'ready', protocol: PREVIEW_PROTOCOL };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PreviewFrame', () => {
  it('loads the preview origin in a sandboxed iframe without referrer', () => {
    const { iframe } = renderFrame();
    expect(iframe).toHaveAttribute('src', `${ORIGIN}/`);
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-top-navigation');
    expect(sandbox).not.toContain('allow-popups');
  });

  it('sends nothing until the preview reports ready, then renders to the exact origin', () => {
    const { win, postMessage } = renderFrame();
    expect(postMessage).not.toHaveBeenCalled();

    dispatch(ready, ORIGIN, win);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, target] = postMessage.mock.calls[0] ?? [];
    expect(target).toBe(ORIGIN);
    expect(toPreviewSchema.parse(message)).toEqual({
      type: 'render',
      protocol: PREVIEW_PROTOCOL,
      path: PATH,
      code: CODE,
      tokensCss: TOKENS,
      mode: 'design',
    });
  });

  it('never posts to the wildcard origin', () => {
    const { win, postMessage, rerender } = renderFrame();
    dispatch(ready, ORIGIN, win);
    rerender(
      <PreviewFrame
        previewOrigin={ORIGIN}
        path={PATH}
        code={`${CODE}\n`}
        tokensCss={TOKENS}
        mode="play"
        title="Home"
        width={390}
        height={844}
        clearSelectionKey={1}
      />,
    );
    expect(postMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of postMessage.mock.calls) {
      expect(call[1]).toBe(ORIGIN);
      expect(call[1]).not.toBe('*');
    }
  });

  it('re-renders when the code or mode changes after ready', () => {
    const props = {
      previewOrigin: ORIGIN,
      path: PATH,
      tokensCss: TOKENS,
      title: 'Home',
      width: 390,
      height: 844,
    };
    const { win, postMessage, rerender } = renderFrame();
    dispatch(ready, ORIGIN, win);
    rerender(<PreviewFrame {...props} code="new code" mode="play" />);
    const last = postMessage.mock.calls.at(-1)?.[0] as { type: string };
    expect(last).toMatchObject({ type: 'render', code: 'new code', mode: 'play' });
  });

  it('sends clearSelection when the clear key changes after ready', () => {
    const props = {
      previewOrigin: ORIGIN,
      path: PATH,
      code: CODE,
      tokensCss: TOKENS,
      mode: 'design' as const,
      title: 'Home',
      width: 390,
      height: 844,
    };
    const { win, postMessage, rerender } = renderFrame({ clearSelectionKey: 0 });
    dispatch(ready, ORIGIN, win);
    postMessage.mockClear();
    rerender(<PreviewFrame {...props} clearSelectionKey={1} />);
    expect(postMessage).toHaveBeenCalledWith({ type: 'clearSelection' }, ORIGIN);
  });

  it('ignores messages from another origin even when the source is the iframe', () => {
    const { win, postMessage, onSelect, onError } = renderFrame();
    dispatch(ready, 'https://evil.test', win);
    dispatch({ type: 'select', element }, 'https://evil.test', win);
    dispatch({ type: 'error', message: 'boom' }, 'https://evil.test', win);
    // A look-alike origin (prefix match) is not the preview origin either.
    dispatch(ready, `${ORIGIN}.evil.test`, win);
    expect(postMessage).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores messages with the right origin from a window other than this iframe', () => {
    const { postMessage, onSelect, onNavigate } = renderFrame();
    const other = document.createElement('iframe');
    document.body.appendChild(other);
    try {
      dispatch(ready, ORIGIN, other.contentWindow);
      dispatch(ready, ORIGIN, window);
      dispatch(ready, ORIGIN, null);
      dispatch({ type: 'select', element }, ORIGIN, other.contentWindow);
      dispatch({ type: 'navigate', route: '/x' }, ORIGIN, null);
    } finally {
      other.remove();
    }
    expect(postMessage).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('ignores messages that do not match the protocol schema', () => {
    const { win, postMessage, onSelect, onNavigate, onError } = renderFrame();
    const invalid: unknown[] = [
      { type: 'ready', protocol: PREVIEW_PROTOCOL + 1 },
      { type: 'ready' },
      'ready',
      null,
      { type: 'select', element: { ...element, line: 0 } },
      { type: 'navigate', route: 'x'.repeat(121) },
      { type: 'eval', code: 'alert(1)' },
    ];
    for (const data of invalid) {
      expect(fromPreviewSchema.safeParse(data).success).toBe(false);
      dispatch(data, ORIGIN, win);
    }
    expect(postMessage).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports selections for its own file and ignores selections for another file', () => {
    const { win, onSelect } = renderFrame();
    dispatch({ type: 'select', element: { ...element, path: 'src/pages/other.tsx' } }, ORIGIN, win);
    expect(onSelect).not.toHaveBeenCalled();
    dispatch({ type: 'select', element }, ORIGIN, win);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(element);
  });

  it('forwards navigate, error and rendered messages', () => {
    const { win, onNavigate, onError } = renderFrame();
    dispatch({ type: 'navigate', route: '/checkout' }, ORIGIN, win);
    expect(onNavigate).toHaveBeenCalledWith('/checkout', 'instant');
    dispatch({ type: 'error', message: 'ReferenceError: x is not defined' }, ORIGIN, win);
    expect(onError).toHaveBeenLastCalledWith('ReferenceError: x is not defined');
    dispatch({ type: 'rendered', path: PATH }, ORIGIN, win);
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('stops listening after unmount', () => {
    const { win, onNavigate, unmount } = renderFrame();
    unmount();
    dispatch({ type: 'navigate', route: '/checkout' }, ORIGIN, win);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('passes on layer trees for its own file and sends select-by-location requests', () => {
    const onTree = vi.fn();
    const { win, postMessage, rerender } = renderFrame({ onTree });
    dispatch(ready, ORIGIN, win);
    const nodes = [{ line: 3, column: 4, tag: 'h1', label: 'Hi', children: [] }];
    dispatch({ type: 'tree', path: 'src/pages/other.tsx', nodes }, ORIGIN, win);
    expect(onTree).not.toHaveBeenCalled();
    dispatch({ type: 'tree', path: PATH, nodes }, ORIGIN, win);
    expect(onTree).toHaveBeenCalledWith(nodes);
    dispatch({ type: 'tree', path: PATH, nodes }, 'https://evil.test', win);
    expect(onTree).toHaveBeenCalledTimes(1);

    rerender(
      <PreviewFrame
        previewOrigin={ORIGIN}
        path={PATH}
        code={CODE}
        tokensCss={TOKENS}
        mode="design"
        title="Home"
        width={390}
        height={844}
        onTree={onTree}
        selectRequest={{ line: 3, column: 4, nonce: 1 }}
      />,
    );
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'selectLoc', line: 3, column: 4 }, ORIGIN);
  });
});
