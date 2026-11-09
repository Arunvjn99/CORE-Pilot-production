import type { CredentialSummary, SessionResponse } from '@core-studio/contracts';
import { Building2, KeyRound, Users } from 'lucide-react';
import { Dialog, Switch, Tabs } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { hasPermission } from '../auth/permissions';
import { useSession } from '../auth/use-session';
import { ActivityFeed } from './activity-feed';
import {
  type LlmMutations,
  type PlatformCredential,
  useActivity,
  useCredentials,
  useDefaultModel,
  useLlmMutations,
  usePlatformCredentials,
  usePolicy,
} from './ai-providers-api';
import { AddCredentialDialog } from './credential-dialogs';
import { CredentialList, type CredentialPermissions } from './credential-list';
import { DefaultModelCard } from './default-model-card';
import { isReauthError, StepUpNotice, useRecentAuth } from './step-up';

export function AiProvidersPage() {
  const { data: session } = useSession();
  if (!session?.activeOrganizationId) return null;
  return <AiProviders session={session} teamId={session.activeOrganizationId} />;
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-sm text-text-muted">
      {children}
    </p>
  );
}

/** Active credentials first; revoked ones stay visible (audit) but tucked away. */
function splitByStatus<T extends CredentialSummary>(rows: T[]) {
  return {
    active: rows.filter((r) => r.status === 'active'),
    revoked: rows.filter((r) => r.status === 'revoked'),
  };
}

function RevokedSection({
  rows,
  mutations,
}: {
  rows: CredentialSummary[];
  mutations: LlmMutations;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm text-text-muted">Revoked ({rows.length})</summary>
      <div className="mt-3">
        <CredentialList
          credentials={rows}
          emptyState={null}
          permissionsFor={() => ({ canTest: false, canChange: false })}
          mutations={mutations}
        />
      </div>
    </details>
  );
}

const tabTrigger =
  'inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-text';

function AiProviders({ session, teamId }: { session: SessionResponse; teamId: string }) {
  const credentials = useCredentials(teamId);
  const policy = usePolicy(teamId);
  const defaultModel = useDefaultModel(teamId);
  const activity = useActivity(teamId);
  const mutations = useLlmMutations(teamId);
  const canManage = hasPermission(session, 'providers:manage');
  const canPersonal = hasPermission(session, 'credentials:personal');
  const isCompanyAdmin = hasPermission(session, 'platform-credentials:manage');
  const rows = credentials.data ?? [];
  const team = splitByStatus(rows.filter((r) => r.scope === 'organization'));
  const personal = splitByStatus(rows.filter((r) => r.scope === 'user'));
  const company = rows.filter((r) => r.scope === 'platform');
  const personalAllowed = policy.data?.allowPersonalCredentials ?? false;
  const teamPermissions = (): CredentialPermissions => ({
    canTest: canManage,
    canChange: canManage,
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <p className="text-sm text-text-muted">
          Keys are encrypted before they are stored and are never shown again. Connection tests run
          through the AI runtime, the only service that can decrypt them.
        </p>
        {credentials.isError && <ErrorMessage>Credentials could not be loaded.</ErrorMessage>}
        {credentials.isPending && <p role="status">Loading credentials…</p>}
        {credentials.data && (
          <Tabs.Root defaultValue="team" className="space-y-4">
            <Tabs.List
              aria-label="Credential scope"
              className="flex flex-wrap gap-1 border-b border-border"
            >
              <Tabs.Trigger value="team" className={tabTrigger}>
                <Users size={16} aria-hidden="true" />
                Team ({team.active.length + company.length})
              </Tabs.Trigger>
              <Tabs.Trigger value="personal" className={tabTrigger}>
                <KeyRound size={16} aria-hidden="true" />
                Personal ({personal.active.length})
              </Tabs.Trigger>
              {isCompanyAdmin && (
                <Tabs.Trigger value="company" className={tabTrigger}>
                  <Building2 size={16} aria-hidden="true" />
                  Company-managed
                </Tabs.Trigger>
              )}
            </Tabs.List>

            <Tabs.Content value="team" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Team credentials</h2>
                {canManage && <AddCredentialDialog target="organization" mutations={mutations} />}
              </div>
              <CredentialList
                credentials={team.active}
                permissionsFor={teamPermissions}
                mutations={mutations}
                emptyState={
                  <Empty>
                    No team credentials yet.{' '}
                    {canManage
                      ? 'Add one to let this team use an AI provider.'
                      : 'A team owner or admin can add one.'}
                  </Empty>
                }
              />
              {company.length > 0 && (
                <>
                  <h3 className="pt-2 font-semibold">Shared by your company</h3>
                  <CredentialList
                    credentials={company}
                    permissionsFor={() => ({ canTest: canManage, canChange: false })}
                    mutations={mutations}
                    emptyState={null}
                  />
                </>
              )}
              <RevokedSection rows={team.revoked} mutations={mutations} />
              {canManage && (
                <PersonalPolicySwitch
                  allowed={personalAllowed}
                  loading={policy.isPending}
                  mutations={mutations}
                />
              )}
            </Tabs.Content>

            <Tabs.Content value="personal" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Your personal credentials</h2>
                {canPersonal && personalAllowed && (
                  <AddCredentialDialog
                    target="user"
                    mutations={mutations}
                    triggerLabel="Add personal key"
                  />
                )}
              </div>
              {!canPersonal ? (
                <Empty>Your role in this team can’t hold personal credentials.</Empty>
              ) : !personalAllowed && personal.active.length === 0 ? (
                <Empty>
                  Personal credentials are turned off for this team. A team owner or admin can turn
                  them on.
                </Empty>
              ) : (
                <CredentialList
                  credentials={personal.active}
                  permissionsFor={() => ({ canTest: true, canChange: true })}
                  mutations={mutations}
                  emptyState={
                    <Empty>
                      You have no personal credentials. Only you can see the ones you add here.
                    </Empty>
                  }
                />
              )}
              <RevokedSection rows={personal.revoked} mutations={mutations} />
            </Tabs.Content>

            {isCompanyAdmin && (
              <Tabs.Content value="company">
                <CompanyCredentials session={session} mutations={mutations} />
              </Tabs.Content>
            )}
          </Tabs.Root>
        )}
      </div>
      <aside className="space-y-6" aria-label="Defaults and activity">
        <DefaultModelCard
          current={defaultModel.data ?? undefined}
          candidates={[...team.active, ...company]}
          canManage={canManage}
          mutations={mutations}
        />
        <ActivityFeed events={activity.data} isError={activity.isError} />
      </aside>
    </div>
  );
}

function PersonalPolicySwitch({
  allowed,
  loading,
  mutations,
}: {
  allowed: boolean;
  loading: boolean;
  mutations: LlmMutations;
}) {
  const recent = useRecentAuth();
  const [showStepUp, setShowStepUp] = useState(false);
  const { setPolicy } = mutations;
  const needStepUp = showStepUp || isReauthError(setPolicy.error);
  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-labelledby="policy-heading"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 id="policy-heading" className="font-semibold">
            Personal credentials
          </h3>
          <p className="text-sm text-text-muted">
            Let members use their own keys in this team. Personal keys stay private to their owner.
          </p>
        </div>
        <Switch.Root
          aria-labelledby="policy-heading"
          checked={allowed}
          disabled={loading || setPolicy.isPending}
          onCheckedChange={(checked) => {
            if (!recent) {
              setShowStepUp(true);
              return;
            }
            setPolicy.mutate({ allowPersonalCredentials: checked });
          }}
          className="relative h-6 w-11 shrink-0 rounded-full border border-border bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent data-[state=checked]:bg-accent"
        >
          <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5" />
        </Switch.Root>
      </div>
      {needStepUp && <StepUpNotice action="change this policy" />}
      {setPolicy.error && !isReauthError(setPolicy.error) && (
        <ErrorMessage>
          {setPolicy.error instanceof ApiError ? setPolicy.error.message : 'Could not save.'}
        </ErrorMessage>
      )}
    </section>
  );
}

function CompanyCredentials({
  session,
  mutations,
}: {
  session: SessionResponse;
  mutations: LlmMutations;
}) {
  const platform = usePlatformCredentials(true);
  const { active, revoked } = splitByStatus(platform.data ?? []);
  const teamName = (id: string) =>
    session.organizations.find((o) => o.id === id)?.name ?? 'Unknown team';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Company-managed credentials</h2>
          <p className="text-sm text-text-muted">
            Managed centrally and shared with selected teams.
          </p>
        </div>
        <AddCredentialDialog target="platform" mutations={mutations} />
      </div>
      {platform.isError && <ErrorMessage>Company credentials could not be loaded.</ErrorMessage>}
      {platform.data && (
        <CredentialList
          credentials={active}
          platform
          permissionsFor={() => ({ canTest: true, canChange: true })}
          mutations={mutations}
          extraActions={(credential) => (
            <TeamAccessDialog
              credential={credential as PlatformCredential}
              session={session}
              mutations={mutations}
            />
          )}
          emptyState={<Empty>No company-managed credentials yet.</Empty>}
        />
      )}
      {active.length > 0 && (
        <ul className="space-y-1 text-sm text-text-muted">
          {active.map((c) => (
            <li key={c.id}>
              <span className="font-medium text-text">{c.label}</span>:{' '}
              {c.entitledOrganizationIds.length === 0
                ? 'not shared with any team'
                : c.entitledOrganizationIds.map(teamName).join(', ')}
            </li>
          ))}
        </ul>
      )}
      <RevokedSection rows={revoked} mutations={mutations} />
    </div>
  );
}

function TeamAccessDialog({
  credential,
  session,
  mutations,
}: {
  credential: PlatformCredential;
  session: SessionResponse;
  mutations: LlmMutations;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(credential.entitledOrganizationIds);
  const recent = useRecentAuth();
  const { setEntitlements } = mutations;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSelected(credential.entitledOrganizationIds);
        else setEntitlements.reset();
      }}
    >
      <Dialog.Trigger asChild>
        <Button aria-label={`Team access for ${credential.label}`}>Team access</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] -translate-1/2 space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">
            Team access: {credential.label}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-text-muted">
            Selected teams can use this credential. Removing a team also clears it as that team’s
            default model.
          </Dialog.Description>
          {!recent || isReauthError(setEntitlements.error) ? (
            <StepUpNotice action="change team access" />
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setEntitlements.mutate(
                  { id: credential.id, organizationIds: selected },
                  {
                    onSuccess: () => {
                      setOpen(false);
                    },
                  },
                );
              }}
            >
              <fieldset className="max-h-64 space-y-1 overflow-y-auto">
                <legend className="sr-only">Teams</legend>
                {session.organizations.map((org) => (
                  <label
                    key={org.id}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(org.id)}
                      onChange={(event) => {
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, org.id]
                            : current.filter((id) => id !== org.id),
                        );
                      }}
                    />
                    {org.name}
                  </label>
                ))}
              </fieldset>
              {setEntitlements.error && (
                <ErrorMessage>
                  {setEntitlements.error instanceof ApiError
                    ? setEntitlements.error.message
                    : 'Could not save.'}
                </ErrorMessage>
              )}
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button>Cancel</Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" disabled={setEntitlements.isPending}>
                  Save access
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
