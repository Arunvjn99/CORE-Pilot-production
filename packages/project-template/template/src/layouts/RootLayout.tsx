import type { MouseEvent } from 'react';
import { Outlet, useNavigate } from 'react-router';

export function RootLayout() {
  const navigate = useNavigate();
  // Screens designed in CORE Studio link with `data-link="/route"` (set in the Prototype tab).
  const followLink = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest('[data-link]') : null;
    const to = target?.getAttribute('data-link');
    if (to?.startsWith('/')) {
      event.preventDefault();
      void navigate(to);
    }
  };
  return (
    <div className="flex min-h-dvh flex-col bg-white text-slate-900" onClickCapture={followLink}>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
