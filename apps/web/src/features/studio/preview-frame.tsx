import {
  fromPreviewSchema,
  type LayerNode,
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
  onTree,
  selectRequest,
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
  /** A prototype link was followed: a screen route or "back", with its transition. */
  onNavigate?: (route: string, transition: 'instant' | 'dissolve') => void;
  onError?: (message: string | null) => void;
  /** The screen's layer tree after each render. */
  onTree?: (nodes: LayerNode[]) => void;
  /** Select the element at this source location (a new `nonce` repeats the request). */
  selectRequest?: { line: number; column: number; nonce: number } | undefined;
  /** Changing this value clears the selection outline inside the frame. */
  clearSelectionKey?: number | undefined;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onSelect, onNavigate, onError, onTree });
  useEffect(() => {
    handlers.current = { onSelect, onNavigate, onError, onTree };
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
          handlers.current.onNavigate?.(message.route, message.transition);
          break;
        case 'error':
          handlers.current.onError?.(message.message);
          break;
        case 'tree':
          if (message.path === path) handlers.current.onTree?.(message.nodes);
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
    if (ready && selectRequest)
      send({ type: 'selectLoc', line: selectRequest.line, column: selectRequest.column });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send is stable for a given origin
  }, [ready, selectRequest?.nonce]);

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
