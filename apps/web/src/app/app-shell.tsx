import { Outlet } from 'react-router';
import { useSession } from '../features/auth/use-session';
import { NoTeamPage } from '../features/teams/no-team-page';
import { TeamSwitcher } from '../features/teams/team-switcher';
import { MainNavigation } from './navigation';
import { UserMenu } from './user-menu';

export function AppShell() {
  const { data: session } = useSession();
  if (!session) return null;
  const hasTeam = session.activeOrganizationId !== null;

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-surface focus:p-2"
      >
        Skip to content
      </a>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2 md:px-6">
        <p className="text-base font-semibold">CORE AI Design Studio</p>
        <div className="flex items-center gap-3">
          <TeamSwitcher session={session} />
          <UserMenu session={session} />
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        {hasTeam && (
          <aside className="border-b border-border p-2 md:w-56 md:border-r md:border-b-0 md:p-3">
            <MainNavigation session={session} />
          </aside>
        )}
        <main id="main" className="flex-1 px-4 py-6 md:px-8">
          {hasTeam ? <Outlet /> : <NoTeamPage session={session} />}
        </main>
      </div>
    </div>
  );
}
