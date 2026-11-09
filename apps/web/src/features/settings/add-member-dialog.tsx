import type { MembershipRole } from '@core-studio/contracts';
import { UserPlus } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { ROLE_LABELS, useDirectorySearch, useMemberMutations } from './members-api';

export function AddMemberDialog({
  teamId,
  assignableRoles,
}: {
  teamId: string;
  assignableRoles: MembershipRole[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [role, setRole] = useState<MembershipRole>('designer');
  const results = useDirectorySearch(query);
  const { add } = useMemberMutations(teamId);
  const searchId = useId();
  const roleId = useId();

  const reset = () => {
    setQuery('');
    setSelected(null);
    setRole('designer');
    add.reset();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="primary">
          <UserPlus size={16} aria-hidden="true" />
          Add member
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-1/2 space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">Add a team member</Dialog.Title>
          <Dialog.Description className="text-sm text-text-muted">
            People appear in the directory after they have signed in once with their company
            account.
          </Dialog.Description>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!selected) return;
              add.mutate(
                { userId: selected, role },
                {
                  onSuccess: () => {
                    setOpen(false);
                    reset();
                  },
                },
              );
            }}
          >
            <div className="space-y-1">
              <label htmlFor={searchId} className="text-sm">
                Search by name or email
              </label>
              <input
                id={searchId}
                type="search"
                autoComplete="off"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(null);
                }}
              />
            </div>
            {results.data && (
              <fieldset className="max-h-48 space-y-1 overflow-y-auto">
                <legend className="sr-only">Matching people</legend>
                {results.data.length === 0 && (
                  <p className="text-sm text-text-muted">No matching people.</p>
                )}
                {results.data.map((user) => (
                  <label
                    key={user.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted"
                  >
                    <input
                      type="radio"
                      name="member"
                      value={user.id}
                      checked={selected === user.id}
                      onChange={() => {
                        setSelected(user.id);
                      }}
                    />
                    <span>{user.displayName}</span>
                    {user.email && <span className="text-text-muted">{user.email}</span>}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="space-y-1">
              <label htmlFor={roleId} className="text-sm">
                Role
              </label>
              <select
                id={roleId}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as MembershipRole);
                }}
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            {add.error && (
              <ErrorMessage>
                {add.error instanceof ApiError ? add.error.message : 'Could not add the member.'}
              </ErrorMessage>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button>Cancel</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={!selected || add.isPending}>
                Add to team
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
