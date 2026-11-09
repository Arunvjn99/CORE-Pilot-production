import type { Member, MembershipRole, SessionResponse } from '@core-studio/contracts';
import { AlertDialog } from 'radix-ui';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { hasPermission } from '../auth/permissions';
import { useSession } from '../auth/use-session';
import { AddMemberDialog } from './add-member-dialog';
import { ROLE_LABELS, useMemberMutations, useMembers } from './members-api';

const ALL_ROLES: MembershipRole[] = ['org_owner', 'org_admin', 'designer', 'viewer'];

/** Mirrors the API rule (owners/company admins manage owners). The API remains the authority. */
export function assignableRoles(
  session: SessionResponse,
  myRole: MembershipRole | null,
): MembershipRole[] {
  if (session.user.platformAdmin || myRole === 'org_owner') return ALL_ROLES;
  return ALL_ROLES.filter((role) => role !== 'org_owner');
}

export function MembersPage() {
  const { data: session } = useSession();
  const teamId = session?.activeOrganizationId;
  if (!session || !teamId) return null;
  return <MembersTable session={session} teamId={teamId} />;
}

function MembersTable({ session, teamId }: { session: SessionResponse; teamId: string }) {
  const members = useMembers(teamId);
  const mutations = useMemberMutations(teamId);
  const canManage = hasPermission(session, 'members:manage');
  const myRole = session.organizations.find((org) => org.id === teamId)?.role ?? null;
  const roles = assignableRoles(session, myRole);
  const mutationError = mutations.changeRole.error ?? mutations.remove.error;

  return (
    <section aria-labelledby="members-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="members-heading" className="text-lg font-semibold">
          Team members
        </h2>
        {canManage && <AddMemberDialog teamId={teamId} assignableRoles={roles} />}
      </div>
      {mutationError && (
        <ErrorMessage>
          {mutationError instanceof ApiError
            ? mutationError.message
            : 'The change could not be saved.'}
        </ErrorMessage>
      )}
      {members.isPending && <p role="status">Loading members…</p>}
      {members.isError && <ErrorMessage>Members could not be loaded.</ErrorMessage>}
      {members.data && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Email
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Role
                </th>
                {canManage && (
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.data.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  canManage={canManage}
                  roles={roles}
                  isSelf={member.userId === session.user.id}
                  mutations={mutations}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MemberRow({
  member,
  canManage,
  roles,
  isSelf,
  mutations,
}: {
  member: Member;
  canManage: boolean;
  roles: MembershipRole[];
  isSelf: boolean;
  mutations: ReturnType<typeof useMemberMutations>;
}) {
  const editable = canManage && roles.includes(member.role);
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2">
        {member.displayName}
        {isSelf && <span className="ml-1 text-text-muted">(you)</span>}
      </td>
      <td className="px-4 py-2 text-text-muted">{member.email ?? '—'}</td>
      <td className="px-4 py-2">
        {editable ? (
          <select
            aria-label={`Role for ${member.displayName}`}
            className="rounded-md border border-border bg-surface px-2 py-1"
            value={member.role}
            disabled={mutations.changeRole.isPending}
            onChange={(event) => {
              mutations.changeRole.mutate({
                userId: member.userId,
                role: event.target.value as MembershipRole,
              });
            }}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        ) : (
          ROLE_LABELS[member.role]
        )}
      </td>
      {canManage && (
        <td className="px-4 py-2 text-right">
          {editable && (
            <AlertDialog.Root>
              <AlertDialog.Trigger asChild>
                <Button variant="danger" aria-label={`Remove ${member.displayName}`}>
                  Remove
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 bg-black/40" />
                <AlertDialog.Content className="fixed top-1/2 left-1/2 w-[min(26rem,calc(100vw-2rem))] -translate-1/2 space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
                  <AlertDialog.Title className="text-lg font-semibold">
                    Remove {member.displayName}?
                  </AlertDialog.Title>
                  <AlertDialog.Description className="text-sm text-text-muted">
                    They will lose access to this team&apos;s projects. You can add them again
                    later.
                  </AlertDialog.Description>
                  <div className="flex justify-end gap-2">
                    <AlertDialog.Cancel asChild>
                      <Button>Cancel</Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                      <Button
                        variant="danger"
                        onClick={() => {
                          mutations.remove.mutate(member.userId);
                        }}
                      >
                        Remove
                      </Button>
                    </AlertDialog.Action>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          )}
        </td>
      )}
    </tr>
  );
}
