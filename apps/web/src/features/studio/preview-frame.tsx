import {
  fromPreviewSchema,
  PREVIEW_PROTOCOL,
  type PreviewMode,
  type SelectedElement,
  type ToPreview,
  toPreviewSchema,
} from '@core-studio/contracts';
import { useEffect, useRef, useState } from 'react';

/**
 * One live screen. The iframe is served from the preview origin (a different site). Messages are
 * accepted only from that exact origin AND from this iframe's window, validated with the protocol
 * schemas, and sent only to that exact origin — never `*`.
 */
export function PreviewFrame({
  previewOrigin,
  path,
  code,
  tokensCss,
  mode,
  title,
  width,
  height,
  onSelect,
  onNavigate,
  onError,
  clearSelectionKey,
}: {
  previewOrigin: string;
  path: string;
  code: string;
  tokensCss: string;
  mode: PreviewMode;
  title: string;
  width: number;
  height: number;
  onSelect?: (element: SelectedElement) => void;
  onNavigate?: (route: string) => void;
  onError?: (message: string | null) => void;
  /** Changing this value clears the selection outline inside the frame. */
  clearSelectionKey?: number | undefined;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onSelect, onNavigate, onError });
  useEffect(() => {
    handlers.current = { onSelect, onNavigate, onError };
  });

  const send = (message: ToPreview) => {
    frame.current?.contentWindow?.postMessage(toPreviewSchema.parse(message), previewOrigin);
  };

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== previewOrigin || event.source !== frame.current?.contentWindow) return;
      const parsed = fromPreviewSchema.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
      switch (message.type) {
        case 'ready':
          setReady(true);
          break;
        case 'rendered':
          handlers.current.onError?.(null);
          break;
        case 'select':
          if (message.element.path === path) handlers.current.onSelect?.(message.element);
          break;
        case 'navigate':
          handlers.current.onNavigate?.(message.route);
          break;
        case 'error':
          handlers.current.onError?.(message.message);
          break;
      }
    };
    window.addEventListener('message', listener);
    return () => {
      window.removeEventListener('message', listener);
    };
  }, [previewOrigin, path]);

  useEffect(() => {
    if (ready) send({ type: 'render', protocol: PREVIEW_PROTOCOL, path, code, tokensCss, mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send is stable for a given origin
  }, [ready, path, code, tokensCss, mode]);

  useEffect(() => {
    if (ready && clearSelectionKey !== undefined) send({ type: 'clearSelection' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send is stable for a given origin
  }, [clearSelectionKey]);

  return (
    <iframe
      ref={frame}
      src={`${previewOrigin}/`}
      title={title}
      width={width}
      height={height}
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
      className="block border-0 bg-white"
      style={{ width, height }}
    />
  );
}
