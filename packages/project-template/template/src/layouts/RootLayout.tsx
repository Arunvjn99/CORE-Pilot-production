import { Outlet } from 'react-router';

export function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-slate-900">
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
