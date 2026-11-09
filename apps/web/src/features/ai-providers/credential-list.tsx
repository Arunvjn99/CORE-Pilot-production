import type { CredentialSummary, CredentialTestResult } from '@core-studio/contracts';
import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Loader2,
  PlugZap,
  TriangleAlert,
} from 'lucide-react';
import { AlertDialog } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import type { LlmMutations } from './ai-providers-api';
import { RotateKeyDialog } from './credential-dialogs';
import { maskedKey, probeStatus, providerInfo, type Tone } from './providers';
import { isReauthError, StepUpNotice, useRecentAuth } from './step-up';

const TONE_CLASS: Record<Tone, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  neutral: 'border-border bg-surface-muted text-text-muted',
};
const TONE_ICON: Record<Tone, ReactNode> = {
  success: <CheckCircle2 size={14} aria-hidden="true" />,
  warning: <TriangleAlert size={14} aria-hidden="true" />,
  danger: <CircleAlert size={14} aria-hidden="true" />,
  neutral: <CircleDashed size={14} aria-hidden="true" />,
};

export function StatusBadge({ code, testing }: { code: string | null; testing?: boolean }) {
  if (testing)
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASS.neutral}`}
      >
        <Loader2 size={14} aria-hidden="true" className="animate-spin" />
        Testing…
      </span>
    );
  const status = probeStatus(code);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[status.tone]}`}
    >
      {TONE_ICON[status.tone]}
      {status.label}
    </span>
  );
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const formatTime = (iso: string) => dateTime.format(new Date(iso));

export interface CredentialPermissions {
  canTest: boolean;
  canChange: boolean;
}

export function CredentialList({
  credentials,
  emptyState,
  permissionsFor,
  mutations,
  platform = false,
  extraActions,
}: {
  credentials: CredentialSummary[];
  emptyState: ReactNode;
  permissionsFor: (credential: CredentialSummary) => CredentialPermissions;
  mutations: LlmMutations;
  platform?: boolean;
  extraActions?: (credential: CredentialSummary) => ReactNode;
}) {
  if (credentials.length === 0) return <>{emptyState}</>;
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {credentials.map((credential) => (
        <CredentialCard
          key={credential.id}
          credential={credential}
          permissions={permissionsFor(credential)}
          mutations={mutations}
          platform={platform || credential.scope === 'platform'}
          manageAsPlatformAdmin={platform}
          extraActions={extraActions?.(credential)}
        />
      ))}
    </ul>
  );
}

function CredentialCard({
  credential,
  permissions,
  mutations,
  platform,
  manageAsPlatformAdmin,
  extraActions,
}: {
  credential: CredentialSummary;
  permissions: CredentialPermissions;
  mutations: LlmMutations;
  platform: boolean;
  manageAsPlatformAdmin: boolean;
  extraActions?: ReactNode;
}) {
  const info = providerInfo(credential.provider);
  const [result, setResult] = useState<CredentialTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const active = credential.status === 'active';
  const code = result?.code ?? credential.lastTestCode;
  const testedAt = result?.testedAt ?? credential.lastTestedAt;
  const headingId = `cred-${credential.id}`;

  const runTest = () => {
    setTesting(true);
    setTestError(null);
    mutations.test.mutate(
      { id: credential.id, platform: manageAsPlatformAdmin },
      {
        onSuccess: setResult,
        onError: (error) => {
          setTestError(error instanceof ApiError ? error.message : 'The test could not be run.');
        },
        onSettled: () => {
          setTesting(false);
        },
      },
    );
  };

  return (
    <li
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 ${active ? '' : 'opacity-70'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="truncate font-semibold">
            {credential.label}
          </h3>
          <p className="text-sm text-text-muted">{info.name}</p>
        </div>
        {active ? (
          <span aria-live="polite">
            <StatusBadge code={code} testing={testing} />
          </span>
        ) : (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
            Revoked
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">Key</dt>
        <dd className="font-mono" aria-label="Masked key">
          {active ? maskedKey(credential.hasSecret, credential.displayHint) : 'Destroyed'}
        </dd>
        {credential.endpoint && (
          <>
            <dt className="text-text-muted">Endpoint</dt>
            <dd className="truncate" title={credential.endpoint}>
              {credential.endpoint}
            </dd>
          </>
        )}
        {credential.deployment && (
          <>
            <dt className="text-text-muted">Deployment</dt>
            <dd>
              {credential.deployment}{' '}
              <span className="text-text-muted">({credential.apiVersion})</span>
            </dd>
          </>
        )}
        <dt className="text-text-muted">Added</dt>
        <dd>{formatTime(credential.createdAt)}</dd>
        {credential.rotatedAt && (
          <>
            <dt className="text-text-muted">Rotated</dt>
            <dd>{formatTime(credential.rotatedAt)}</dd>
          </>
        )}
        {active && testedAt && (
          <>
            <dt className="text-text-muted">Last test</dt>
            <dd>{formatTime(testedAt)}</dd>
          </>
        )}
      </dl>
      {result && (
        <p role="status" className="text-sm text-text-muted">
          {result.message}
          {result.code === 'ok' &&
            ` · ${String(result.models.length)} model${result.models.length === 1 ? '' : 's'} available · ${String(result.latencyMs)} ms`}
        </p>
      )}
      {testError && <ErrorMessage>{testError}</ErrorMessage>}
      {active && (permissions.canTest || permissions.canChange || extraActions) && (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
          {permissions.canTest && (
            <Button
              onClick={runTest}
              disabled={testing}
              aria-label={`Test connection for ${credential.label}`}
            >
              <PlugZap size={14} aria-hidden="true" />
              Test
            </Button>
          )}
          {permissions.canChange && credential.hasSecret && (
            <RotateKeyDialog
              id={credential.id}
              label={credential.label}
              platform={platform}
              mutations={mutations}
            />
          )}
          {extraActions}
          {permissions.canChange && (
            <RevokeButton credential={credential} platform={platform} mutations={mutations} />
          )}
        </div>
      )}
    </li>
  );
}

function RevokeButton({
  credential,
  platform,
  mutations,
}: {
  credential: CredentialSummary;
  platform: boolean;
  mutations: LlmMutations;
}) {
  const recent = useRecentAuth();
  const { revoke } = mutations;
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) revoke.reset();
      }}
    >
      <AlertDialog.Trigger asChild>
        <Button variant="danger" className="ml-auto" aria-label={`Revoke ${credential.label}`}>
          Revoke
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-1/2 space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
          <AlertDialog.Title className="text-lg font-semibold">
            Revoke {credential.label}?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-text-muted">
            The stored key is destroyed immediately and can’t be restored.
            {platform ? ' Every team loses access to it.' : ''} If it is the default model, the
            default is cleared. The record stays in the audit trail.
          </AlertDialog.Description>
          {!recent || isReauthError(revoke.error) ? (
            <StepUpNotice action="revoke this credential" />
          ) : (
            <>
              {revoke.error && (
                <ErrorMessage>
                  {revoke.error instanceof ApiError ? revoke.error.message : 'Could not revoke.'}
                </ErrorMessage>
              )}
              <div className="flex justify-end gap-2">
                <AlertDialog.Cancel asChild>
                  <Button>Cancel</Button>
                </AlertDialog.Cancel>
                <Button
                  variant="danger"
                  disabled={revoke.isPending}
                  onClick={() => {
                    revoke.mutate(
                      { id: credential.id, platform },
                      {
                        onSuccess: () => {
                          setOpen(false);
                        },
                      },
                    );
                  }}
                >
                  {revoke.isPending ? 'Revoking…' : 'Revoke credential'}
                </Button>
              </div>
            </>
          )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
