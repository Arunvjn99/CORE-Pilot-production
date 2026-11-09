import { Outlet } from 'react-router';

export function AppShell() {
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">
        Skip to content
      </a>
      <header className="border-b border-border px-6 py-3">
        <p className="text-base font-semibold">CORE AI Design Studio</p>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
