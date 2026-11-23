import { type MouseEvent, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

/**
 * Prototype links designed in CORE Studio (Prototype tab) are attributes on elements:
 * `data-link` = a route or "back"; `data-trigger` = click (default), hover or delay;
 * `data-delay` = milliseconds for "delay".
 */
export function RootLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const main = useRef<HTMLDivElement>(null);

  const follow = (el: Element) => {
    const to = el.getAttribute('data-link');
    if (to === 'back') void navigate(-1);
    else if (to?.startsWith('/')) void navigate(to);
  };
  const linkOf = (target: EventTarget) =>
    target instanceof Element ? target.closest('[data-link]') : null;
  const triggerOf = (el: Element) => el.getAttribute('data-trigger') ?? 'click';

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = linkOf(event.target);
    if (link && triggerOf(link) === 'click') {
      event.preventDefault();
      follow(link);
    }
  };
  const onHover = (event: MouseEvent<HTMLDivElement>) => {
    const link = linkOf(event.target);
    if (link && triggerOf(link) === 'hover') follow(link);
  };

  // "After delay" starts when a screen is shown.
  useEffect(() => {
    const el = main.current?.querySelector('[data-link][data-trigger="delay"]');
    if (!el) return;
    const ms = Math.min(30_000, Math.max(0, Number(el.getAttribute('data-delay') ?? '0') || 0));
    const timer = setTimeout(() => {
      follow(el);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per screen
  }, [pathname]);

  return (
    <div
      ref={main}
      className="flex min-h-dvh flex-col bg-white text-slate-900"
      onClickCapture={onClick}
      onMouseOverCapture={onHover}
    >
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
