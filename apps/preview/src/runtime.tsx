import {
  type FromPreview,
  fromPreviewSchema,
  PREVIEW_PROTOCOL,
  type PreviewMode,
  toPreviewSchema,
} from '@core-studio/contracts';
import * as React from 'react';
import { Component, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { compileScreen } from './compile';
import { describeElement } from './picker';

/**
 * The preview runtime. It runs on its own origin (a different site from the studio), receives screen
 * source only from the configured studio origin, and reports selections/navigation back to it.
 * It has no network access to anything (CSP connect-src 'none' on the preview origin).
 */
interface Config {
  studioOrigin: string;
}

class ErrorBoundary extends Component<
  { onError: (m: string) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error.message);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function evaluate(compiled: string): ComponentType {
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (name === 'react') return React;
    throw new Error(`Screens can only import from 'react' (tried '${name}')`);
  };
  // The preview origin exists to run screen code; it is a separate site with no network access.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('React', 'require', 'module', 'exports', compiled) as (
    react: typeof React,
    req: (name: string) => unknown,
    mod: { exports: Record<string, unknown> },
    exp: Record<string, unknown>,
  ) => void;
  run(React, require, module, module.exports);
  const component = module.exports['default'];
  if (typeof component !== 'function')
    throw new Error('The screen has no default-exported component');
  return component as ComponentType;
}

export async function start(): Promise<void> {
  const response = await fetch('/config.json', { cache: 'no-store' });
  const config = (await response.json()) as Config;
  const studioOrigin = new URL(config.studioOrigin).origin;
  if (window.parent === window) {
    document.body.textContent = 'This page only works inside CORE Studio.';
    return;
  }
  const post = (message: FromPreview) => {
    window.parent.postMessage(fromPreviewSchema.parse(message), studioOrigin);
  };
  const rootElement = document.getElementById('root');
  if (!rootElement) return;
  const tokens = document.createElement('style');
  document.head.append(tokens);
  let root: Root | null = null;
  let mode: PreviewMode = 'design';
  let path = '';
  let selected: Element | null = null;
  const hoverBox = document.getElementById('core-hover');
  const selectBox = document.getElementById('core-select');

  const place = (box: HTMLElement | null, el: Element | null) => {
    if (!box) return;
    if (!el || mode !== 'design') {
      box.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      left: `${String(r.left)}px`,
      top: `${String(r.top)}px`,
      width: `${String(r.width)}px`,
      height: `${String(r.height)}px`,
    });
    box.hidden = false;
  };

  const target = (event: Event) =>
    event.target instanceof Element ? event.target.closest('[data-core-loc]') : null;

  document.addEventListener('mousemove', (event) => {
    place(hoverBox, mode === 'design' ? target(event) : null);
  });
  document.addEventListener(
    'click',
    (event) => {
      const el = target(event);
      if (mode === 'play') {
        const link = event.target instanceof Element ? event.target.closest('[data-link]') : null;
        const route = link?.getAttribute('data-link');
        if (route) {
          event.preventDefault();
          post({ type: 'navigate', route });
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!el) return;
      selected = el;
      place(selectBox, el);
      post({ type: 'select', element: describeElement(el, path) });
    },
    true,
  );
  document.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
    },
    true,
  );
  window.addEventListener(
    'scroll',
    () => {
      place(selectBox, selected);
    },
    true,
  );
  window.addEventListener('error', (event) => {
    post({ type: 'error', message: event.message.slice(0, 2000) });
  });

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== studioOrigin || event.source !== window.parent) return;
    const parsed = toPreviewSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'mode') {
      mode = message.mode;
      place(hoverBox, null);
      place(selectBox, mode === 'design' ? selected : null);
      return;
    }
    if (message.type === 'clearSelection') {
      selected = null;
      place(selectBox, null);
      return;
    }
    mode = message.mode;
    path = message.path;
    tokens.textContent = message.tokensCss;
    try {
      const Screen = evaluate(compileScreen(message.code, message.path));
      root ??= createRoot(rootElement);
      root.render(
        <ErrorBoundary
          key={Math.random()}
          onError={(m) => {
            post({ type: 'error', message: m.slice(0, 2000) });
          }}
        >
          <Screen />
        </ErrorBoundary>,
      );
      requestAnimationFrame(() => {
        if (selected && !selected.isConnected) {
          const loc = selected.getAttribute('data-core-loc');
          selected = loc ? document.querySelector(`[data-core-loc="${CSS.escape(loc)}"]`) : null;
        }
        place(selectBox, selected);
        post({ type: 'rendered', path });
      });
    } catch (error) {
      post({
        type: 'error',
        message: (error instanceof Error ? error.message : 'Render failed').slice(0, 2000),
      });
    }
  });

  post({ type: 'ready', protocol: PREVIEW_PROTOCOL });
}
