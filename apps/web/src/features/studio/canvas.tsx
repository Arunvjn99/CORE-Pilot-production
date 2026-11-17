import type { Screen, SelectedElement } from '@core-studio/contracts';
import { AlertTriangle } from 'lucide-react';
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from 'react';
import { PreviewFrame } from './preview-frame';

export const DEVICES = {
  desktop: { label: 'Desktop', width: 1440, height: 900 },
  tablet: { label: 'Tablet', width: 834, height: 1112 },
  mobile: { label: 'Mobile', width: 390, height: 844 },
} as const;
export type Device = keyof typeof DEVICES;

const GAP = 120;
const LABEL = 40;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Fits every frame in the viewport with a margin. */
export function fitCamera(
  count: number,
  device: Device,
  viewport: { width: number; height: number },
): Camera {
  const { width, height } = DEVICES[device];
  const worldW = Math.max(1, count) * width + Math.max(0, count - 1) * GAP;
  const worldH = height + LABEL;
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min((viewport.width - 96) / worldW, (viewport.height - 96) / worldH)),
  );
  return {
    zoom,
    x: (viewport.width - worldW * zoom) / 2,
    y: Math.max(48, (viewport.height - worldH * zoom) / 2),
  };
}

/**
 * Infinite canvas: screens are live preview frames laid out as a numbered storyboard. Wheel pans,
 * ctrl/⌘ + wheel (or pinch) zooms at the cursor, dragging the empty canvas pans. The camera is a CSS
 * transform, so frames keep rendering at their real device size.
 */
export function Canvas({
  screens,
  tokensCss,
  previewOrigin,
  device,
  camera,
  onCamera,
  selectedPath,
  onSelectScreen,
  onSelectElement,
  clearSelectionKey,
  overlay,
}: {
  screens: Screen[];
  tokensCss: string;
  previewOrigin: string;
  device: Device;
  camera: Camera;
  onCamera: (camera: Camera) => void;
  selectedPath: string | null;
  onSelectScreen: (path: string) => void;
  onSelectElement: (element: SelectedElement) => void;
  clearSelectionKey: number;
  overlay?: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; camera: Camera } | null>(null);
  const [panning, setPanning] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { width, height } = DEVICES[device];

  const onWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const rect = viewport.current?.getBoundingClientRect();
      if (!rect) return;
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-Math.max(-60, Math.min(60, event.deltaY)) * 0.01);
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        onCamera({
          zoom,
          x: px - ((px - camera.x) * zoom) / camera.zoom,
          y: py - ((py - camera.y) * zoom) / camera.zoom,
        });
      } else {
        onCamera({ ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY });
      }
    },
    [camera, onCamera],
  );

  // Prevent the browser's page zoom on ctrl+wheel over the canvas.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const block = (event: globalThis.WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    el.addEventListener('wheel', block, { passive: false });
    return () => {
      el.removeEventListener('wheel', block);
    };
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget &&
      !(event.target as HTMLElement).dataset['canvasBackground']
    )
      return;
    drag.current = { x: event.clientX, y: event.clientY, camera };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    onCamera({
      ...start.camera,
      x: start.camera.x + event.clientX - start.x,
      y: start.camera.y + event.clientY - start.y,
    });
  };
  const endDrag = () => {
    drag.current = null;
    setPanning(false);
  };

  return (
    <div
      ref={viewport}
      role="application"
      aria-label="Design canvas. Scroll to pan, Control or Command plus scroll to zoom."
      className={`relative h-full w-full overflow-hidden bg-canvas ${panning ? 'cursor-grabbing' : 'cursor-default'}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      data-canvas-background="true"
    >
      <div
        data-canvas-background="true"
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${String(camera.x)}px, ${String(camera.y)}px) scale(${String(camera.zoom)})`,
        }}
      >
        {screens.map((screen, index) => {
          const selected = screen.filePath === selectedPath;
          return (
            <section
              key={screen.pageId}
              aria-label={`Screen ${String(index + 1)}: ${screen.name}`}
              className="absolute"
              style={{ left: index * (width + GAP), top: 0, width }}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectScreen(screen.filePath);
                }}
                className={`mb-3 flex max-w-full items-baseline gap-3 truncate rounded px-1 text-left focus-visible:outline-2 focus-visible:outline-accent ${selected ? 'text-accent' : 'text-text-muted'}`}
                style={{ fontSize: Math.max(14, 14 / camera.zoom) }}
              >
                <span className="font-semibold">{String(index + 1).padStart(2, '0')}</span>
                <span className="truncate font-medium text-text">{screen.name}</span>
                <span className="font-mono opacity-70">{screen.route}</span>
              </button>
              <div
                className={`relative overflow-hidden bg-white shadow-xl ring-1 ${selected ? 'ring-accent ring-4' : 'ring-black/10'}`}
                style={{ width, height, pointerEvents: panning ? 'none' : 'auto' }}
                onPointerDown={() => {
                  onSelectScreen(screen.filePath);
                }}
              >
                <PreviewFrame
                  previewOrigin={previewOrigin}
                  path={screen.filePath}
                  code={screen.code}
                  tokensCss={tokensCss}
                  mode="design"
                  title={`Preview of ${screen.name}`}
                  width={width}
                  height={height}
                  clearSelectionKey={selected ? undefined : clearSelectionKey}
                  onSelect={(element) => {
                    onSelectScreen(screen.filePath);
                    onSelectElement(element);
                  }}
                  onError={(message) => {
                    setErrors((current) =>
                      message
                        ? { ...current, [screen.filePath]: message }
                        : Object.fromEntries(
                            Object.entries(current).filter(([k]) => k !== screen.filePath),
                          ),
                    );
                  }}
                />
                {errors[screen.filePath] && (
                  <div
                    role="alert"
                    className="absolute inset-x-0 bottom-0 flex items-start gap-2 bg-danger p-3 text-sm text-white"
                  >
                    <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <span className="line-clamp-3">{errors[screen.filePath]}</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {overlay}
    </div>
  );
}
