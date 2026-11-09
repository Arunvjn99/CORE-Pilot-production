import { Outlet } from 'react-router';
import { useSession } from '../features/auth/use-session';
import { NoTeamPage } from '../features/teams/no-team-page';
import { TeamSwitcher } from '../features/teams/team-switcher';
import { useSignOut } from '../features/teams/teams-api';

export function AppShell() {
  const { data: session } = useSession();
  const signOut = useSignOut();
  if (!session) return null;

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">
        Skip to content
      </a>
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <p className="text-base font-semibold">CORE AI Design Studio</p>
        <div className="flex items-center gap-4">
          <TeamSwitcher session={session} />
          <span className="text-sm" aria-label="Signed in as">
            {session.user.displayName}
          </span>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-sm hover:bg-surface-muted"
            disabled={signOut.isPending}
            onClick={() => {
              signOut.mutate();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-6 py-8">
        {session.activeOrganizationId ? <Outlet /> : <NoTeamPage session={session} />}
      </main>
    </div>
  );
}
