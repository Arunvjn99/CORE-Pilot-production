import type { SessionResponse } from '@core-studio/contracts';
import { type SyntheticEvent, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { useCreateTeam } from './teams-api';

export function NoTeamPage({ session }: { session: SessionResponse }) {
  const create = useCreateTeam();
  const [name, setName] = useState('');

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(name.trim());
  };

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">No team yet</h1>
      {session.user.platformAdmin ? (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-text-muted">
            Create the first team to get started. You will be its owner.
          </p>
          <label className="block space-y-1 text-sm">
            <span>Team name</span>
            <input
              className="w-full rounded-md border border-border bg-surface px-3 py-2"
              value={name}
              minLength={2}
              maxLength={100}
              required
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          {create.error && (
            <p role="alert" className="text-sm text-danger">
              {create.error instanceof ApiError
                ? create.error.message
                : 'Could not create the team.'}
            </p>
          )}
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-60"
          >
            Create team
          </button>
        </form>
      ) : (
        <p className="text-text-muted">
          You are signed in, but you are not a member of any team. Ask a team owner or company
          administrator to add you.
        </p>
      )}
    </div>
  );
}
