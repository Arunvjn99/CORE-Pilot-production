import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '../../test-fixtures';
import { FileThumbnail } from './file-thumbnail';

const FILE = 'a0000000-0000-4000-8000-000000000001';
const ORIGIN = 'http://127.0.0.1:8090';

function stub(screens: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) =>
      Promise.resolve(
        path === '/api/v1/studio/config'
          ? json(200, { previewOrigin: ORIGIN, langsmithEnabled: false })
          : path === `/api/v1/projects/thumbnails?ids=${FILE}`
            ? json(200, screens)
            : json(404, {}),
      ),
    ),
  );
  // jsdom has no layout: give the card a width so the thumbnail can scale.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly cb: ResizeObserverCallback) {}
      observe() {
        this.cb([{ contentRect: { width: 256 } } as ResizeObserverEntry], this as never);
      }
      disconnect() {
        // nothing to release
      }
    },
  );
}

const renderThumb = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FileThumbnail fileId={FILE} label="Checkout" />
    </QueryClientProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FileThumbnail', () => {
  it('renders the first screen live from the preview origin, hidden from assistive tech', async () => {
    stub([{ id: FILE, filePath: 'src/a.tsx', code: 'export default 1', tokensCss: '' }]);
    const { container } = renderThumb();
    await waitFor(() => {
      expect(container.querySelector('iframe')).not.toBeNull();
    });
    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe(`${ORIGIN}/`);
    expect(frame?.getAttribute('title')).toBe('Thumbnail of Checkout');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(frame?.parentElement?.style.transform).toBe('scale(0.2)');
  });

  it('stays a plain placeholder for files without screens', async () => {
    stub([]);
    const { container } = renderThumb();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('batches the cards on a page into one request', async () => {
    const fetchMock = vi.fn((path: string) =>
      Promise.resolve(
        path.startsWith('/api/v1/projects/thumbnails') ? json(200, []) : json(404, {}),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ids = ['a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000b'];
    const { loadThumbnail } = await import('./file-thumbnail');
    expect(await Promise.all(ids.map((id) => loadThumbnail(id)))).toEqual([null, null]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/projects/thumbnails?ids=${ids.join(',')}`);
  });
});
