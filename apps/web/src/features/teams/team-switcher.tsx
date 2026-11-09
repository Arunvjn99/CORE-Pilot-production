import type { SessionResponse } from '@core-studio/contracts';
import { useActivateTeam } from './teams-api';

export function TeamSwitcher({ session }: { session: SessionResponse }) {
  const activate = useActivateTeam();
  const teams = session.organizations.filter(
    (org) => org.role !== null || session.user.platformAdmin,
  );
  if (teams.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-text-muted">Team</span>
      <select
        className="rounded-md border border-border bg-surface px-2 py-1"
        value={session.activeOrganizationId ?? ''}
        disabled={activate.isPending}
        onChange={(event) => {
          activate.mutate(event.target.value);
        }}
      >
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
    </label>
  );
}
