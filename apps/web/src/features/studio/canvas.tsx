import type { LayerNode, Screen, SelectedElement } from '@core-studio/contracts';
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

/** Pans (keeping the zoom) so frame `index` is centred horizontally in the viewport. */
export function focusCamera(
  index: number,
  device: Device,
  viewport: { width: number; height: number },
  camera: Camera,
): Camera {
  const { width } = DEVICES[device];
  const centre = (index * (width + GAP) + width / 2) * camera.zoom;
  return { ...camera, x: viewport.width / 2 - centre };
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

/** A comment pin on a screen; x and y are 0..1 of the screen's size. */
export interface CanvasPin {
  id: string;
  pageId: string;
  x: number;
  y: number;
  number: number;
  label: string;
  active: boolean;
  resolved: boolean;
  pending?: boolean;
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
  tool = 'move',
  pins = [],
  onPlacePin,
  onOpenPin,
  onTree,
  selectRequest,
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
  /** Hand: drag anywhere (screens included) pans. Comment: a click on a screen places a pin. */
  tool?: 'move' | 'hand' | 'comment';
  pins?: CanvasPin[];
  onPlacePin?: (pageId: string, x: number, y: number) => void;
  onOpenPin?: (id: string) => void;
  onTree?: (path: string, nodes: LayerNode[]) => void;
  /** Ask one screen to select the element at a source location (from the Layers panel). */
  selectRequest?: { path: string; line: number; column: number; nonce: number } | null;
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
      tool !== 'hand' &&
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
      className={`relative h-full w-full overflow-hidden bg-canvas ${panning ? 'cursor-grabbing' : tool === 'hand' ? 'cursor-grab' : 'cursor-default'}`}
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
                className={`mb-3 flex max-w-full items-center gap-3 truncate rounded px-1 text-left focus-visible:outline-2 focus-visible:outline-accent ${selected ? 'text-accent' : 'text-text-muted'}`}
                // Readable and at least 24px tall on screen at any zoom (WCAG 2.2 target size).
                style={{
                  fontSize: Math.max(14, 14 / camera.zoom),
                  minHeight: Math.max(24, 24 / camera.zoom),
                }}
              >
                <span className="font-semibold">{String(index + 1).padStart(2, '0')}</span>
                <span className="truncate font-medium text-text">{screen.name}</span>
                <span className="font-mono opacity-70">{screen.route}</span>
              </button>
              <div
                className={`relative overflow-hidden bg-white shadow-xl ring-1 ${selected ? 'ring-accent ring-4' : 'ring-black/10'}`}
                style={{
                  width,
                  height,
                  pointerEvents: panning || tool === 'hand' ? 'none' : 'auto',
                  cursor: tool === 'comment' ? 'crosshair' : undefined,
                }}
                onPointerDown={() => {
                  onSelectScreen(screen.filePath);
                }}
                onClick={(event) => {
                  if (tool !== 'comment' || !onPlacePin) return;
                  if ((event.target as HTMLElement).closest('[data-pin]')) return;
                  const r = event.currentTarget.getBoundingClientRect();
                  const clamp = (v: number) => Math.min(1, Math.max(0, v));
                  onPlacePin(
                    screen.pageId,
                    clamp((event.clientX - r.left) / r.width),
                    clamp((event.clientY - r.top) / r.height),
                  );
                }}
              >
                <div style={{ pointerEvents: tool === 'comment' ? 'none' : 'auto' }}>
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
                    selectRequest={
                      selectRequest?.path === screen.filePath ? selectRequest : undefined
                    }
                    onTree={(nodes) => {
                      onTree?.(screen.filePath, nodes);
                    }}
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
                </div>
                {pins
                  .filter((pin) => pin.pageId === screen.pageId)
                  .map((pin) => (
                    <button
                      key={pin.id}
                      type="button"
                      data-pin
                      aria-label={pin.label}
                      aria-pressed={pin.active}
                      className={`absolute flex h-7 min-w-7 items-center justify-center rounded-full rounded-bl-none border-2 border-white px-1.5 text-xs font-semibold shadow-md focus-visible:outline-2 focus-visible:outline-accent ${pin.resolved ? 'bg-surface-muted text-text-muted' : 'bg-accent text-accent-contrast'} ${pin.active ? 'ring-2 ring-accent ring-offset-2' : ''}`}
                      style={{
                        left: `${String(pin.x * 100)}%`,
                        top: `${String(pin.y * 100)}%`,
                        // Pins keep their size on screen at any zoom; the tip marks the spot.
                        transform: `translate(0, -100%) scale(${String(1 / camera.zoom)})`,
                        transformOrigin: 'bottom left',
                      }}
                      onClick={() => {
                        if (!pin.pending) onOpenPin?.(pin.id);
                      }}
                    >
                      {pin.pending ? '+' : pin.number}
                    </button>
                  ))}
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
