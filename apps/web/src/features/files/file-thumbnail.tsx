import {
  type FileThumbnail as Thumb,
  fileThumbnailSchema,
  MAX_THUMBNAILS,
} from '@core-studio/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiGet } from '../../lib/api-client';
import { PreviewFrame } from '../studio/preview-frame';
import { useStudioConfig } from '../studio/studio-api';

/**
 * Thumbnails are fetched in batches: every card asks for its file, the ids requested within a few
 * milliseconds go out as one request (up to MAX_THUMBNAILS each), so a page of cards costs one call
 * instead of one per file (the API rate-limits per client).
 */
const pending = new Map<string, ((thumb: Thumb | null) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  flushTimer = undefined;
  const batch = [...pending.entries()];
  pending.clear();
  for (let i = 0; i < batch.length; i += MAX_THUMBNAILS) {
    const chunk = batch.slice(i, i + MAX_THUMBNAILS);
    const ids = chunk.map(([id]) => id).join(',');
    apiGet(`/api/v1/projects/thumbnails?ids=${ids}`, z.array(fileThumbnailSchema))
      .then((thumbs) => {
        const byId = new Map(thumbs.map((t) => [t.id, t]));
        for (const [id, resolvers] of chunk)
          for (const resolve of resolvers) resolve(byId.get(id) ?? null);
      })
      .catch(() => {
        for (const [, resolvers] of chunk) for (const resolve of resolvers) resolve(null);
      });
  }
}

export function loadThumbnail(id: string): Promise<Thumb | null> {
  return new Promise((resolve) => {
    pending.set(id, [...(pending.get(id) ?? []), resolve]);
    flushTimer ??= setTimeout(flush, 30);
  });
}

const WIDTH = 1280; // desktop frame, scaled down to the card
const HEIGHT = 800;

/** True once the element has come near the viewport (thumbnails load lazily, once). */
function useNearViewport<T extends Element>() {
  const ref = useRef<T>(null);
  // Without IntersectionObserver (old browsers, tests) thumbnails load right away.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [near]);
  return { ref, near };
}

/**
 * Live thumbnail of a file's first screen, rendered by the preview runtime on its own origin and
 * scaled to the card. Decorative: hidden from assistive technology and not focusable or clickable.
 */
export function FileThumbnail({ fileId, label }: { fileId: string; label: string }) {
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const [width, setWidth] = useState(0);
  const config = useStudioConfig();
  const thumb = useQuery({
    queryKey: ['thumbnail', fileId],
    queryFn: () => loadThumbnail(fileId),
    enabled: near,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  const first = thumb.data;
  const origin = config.data?.previewOrigin;
  const scale = width > 0 ? width / WIDTH : 0;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="relative h-32 overflow-hidden bg-gradient-to-br from-accent/15 to-surface-muted"
    >
      {first && origin && scale > 0 && (
        <div
          className="pointer-events-none absolute top-0 left-0 origin-top-left"
          style={{ transform: `scale(${String(scale)})`, width: WIDTH, height: HEIGHT }}
          inert
        >
          <PreviewFrame
            previewOrigin={origin}
            path={first.filePath}
            code={first.code}
            tokensCss={first.tokensCss}
            mode="play"
            title={`Thumbnail of ${label}`}
            width={WIDTH}
            height={HEIGHT}
          />
        </div>
      )}
    </div>
  );
}
