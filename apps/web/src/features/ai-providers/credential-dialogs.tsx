import type { CreateCredential, LlmProvider } from '@core-studio/contracts';
import { KeyRound, Plus } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type ReactNode, useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import type { LlmMutations } from './ai-providers-api';
import { PROVIDERS, providerInfo } from './providers';
import { isReauthError, StepUpNotice, useRecentAuth } from './step-up';

export type CredentialTarget = 'organization' | 'user' | 'platform';

const TARGET_COPY: Record<CredentialTarget, { title: string; description: string }> = {
  organization: {
    title: 'Add a team credential',
    description: 'Everyone in this team can use it. Only team managers can change it.',
  },
  user: {
    title: 'Add a personal credential',
    description: 'Only you can see or use it. Team owners and company admins cannot.',
  },
  platform: {
    title: 'Add a company-managed credential',
    description: 'Teams can use it only after you grant them access.',
  },
};

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent';

function Field({
  label,
  hint,
  children,
  id,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Write-only key input: never prefilled, not autocompleted, cleared when the dialog closes. */
function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required: boolean;
}) {
  return (
    <input
      id={id}
      type="password"
      autoComplete="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      required={required}
      placeholder={placeholder}
      aria-describedby={`${id}-hint`}
      className={`${inputClass} font-mono`}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}

function errorText(error: unknown, fallback: string): string | null {
  if (!error || isReauthError(error)) return null;
  if (error instanceof ApiError) {
    return error.message;
  }
  return fallback;
}

function DialogShell({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 max-h-[calc(100vh-2rem)] w-[min(32rem,calc(100vw-2rem))] -translate-1/2 space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="text-sm text-text-muted">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const EMPTY = {
  provider: 'openai' as LlmProvider,
  label: '',
  endpoint: '',
  deployment: '',
  apiVersion: '2024-10-21',
  secret: '',
};

export function AddCredentialDialog({
  target,
  mutations,
  triggerLabel = 'Add credential',
}: {
  target: CredentialTarget;
  mutations: LlmMutations;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const recent = useRecentAuth();
  const ids = {
    provider: useId(),
    label: useId(),
    endpoint: useId(),
    deployment: useId(),
    version: useId(),
    secret: useId(),
  };
  const mutation = target === 'platform' ? mutations.createPlatform : mutations.create;
  const info = providerInfo(form.provider);
  const set = (patch: Partial<typeof EMPTY>) => {
    setForm((current) => ({ ...current, ...patch }));
  };
  const close = () => {
    setOpen(false);
    setForm(EMPTY); // drop the typed key from memory
    mutation.reset();
  };
  const needsStepUp = !recent || isReauthError(mutation.error);

  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
      trigger={
        <Button variant="primary">
          <Plus size={16} aria-hidden="true" />
          {triggerLabel}
        </Button>
      }
      title={TARGET_COPY[target].title}
      description={TARGET_COPY[target].description}
    >
      {needsStepUp ? (
        <StepUpNotice action="add a credential" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const input: Omit<CreateCredential, 'scope'> = {
              provider: form.provider,
              label: form.label.trim(),
              ...(info.needsEndpoint ? { endpoint: form.endpoint.trim() } : {}),
              ...(info.azureFields
                ? { deployment: form.deployment.trim(), apiVersion: form.apiVersion.trim() }
                : {}),
              ...(form.secret ? { secret: form.secret } : {}),
            };
            const onSuccess = () => {
              close();
            };
            if (target === 'platform') mutations.createPlatform.mutate(input, { onSuccess });
            else
              mutations.create.mutate(
                { ...input, scope: target },
                {
                  onSuccess,
                },
              );
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Provider</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PROVIDERS.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${form.provider === p.id ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface-muted'}`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name={ids.provider}
                      value={p.id}
                      checked={form.provider === p.id}
                      onChange={() => {
                        set({ provider: p.id });
                      }}
                      className="accent-accent"
                    />
                    {p.name}
                  </span>
                  <span className="mt-1 text-xs text-text-muted">{p.summary}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field id={ids.label} label="Name">
            <input
              id={ids.label}
              required
              maxLength={100}
              className={inputClass}
              placeholder={`e.g. ${info.name} production`}
              value={form.label}
              onChange={(event) => {
                set({ label: event.target.value });
              }}
            />
          </Field>
          {info.needsEndpoint && (
            <Field
              id={ids.endpoint}
              label="Endpoint"
              hint="Must be HTTPS in production. Private network addresses are blocked unless your administrator has allowed them."
            >
              <input
                id={ids.endpoint}
                type="url"
                required
                inputMode="url"
                aria-describedby={`${ids.endpoint}-hint`}
                className={inputClass}
                placeholder={info.endpointPlaceholder}
                value={form.endpoint}
                onChange={(event) => {
                  set({ endpoint: event.target.value });
                }}
              />
            </Field>
          )}
          {info.azureFields && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={ids.deployment} label="Deployment">
                <input
                  id={ids.deployment}
                  required
                  className={inputClass}
                  value={form.deployment}
                  onChange={(event) => {
                    set({ deployment: event.target.value });
                  }}
                />
              </Field>
              <Field id={ids.version} label="API version">
                <input
                  id={ids.version}
                  required
                  className={inputClass}
                  value={form.apiVersion}
                  onChange={(event) => {
                    set({ apiVersion: event.target.value });
                  }}
                />
              </Field>
            </div>
          )}
          <Field
            id={ids.secret}
            label={info.keyLabel}
            hint="Encrypted before it is stored. It can’t be viewed again after you save — only replaced."
          >
            <SecretInput
              id={ids.secret}
              value={form.secret}
              required={!info.secretOptional}
              placeholder={info.keyPlaceholder}
              onChange={(secret) => {
                set({ secret });
              }}
            />
          </Field>
          {errorText(mutation.error, 'The credential could not be saved.') && (
            <ErrorMessage>
              {errorText(mutation.error, 'The credential could not be saved.')}
            </ErrorMessage>
          )}
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button>Cancel</Button>
            </Dialog.Close>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save credential'}
            </Button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

export function RotateKeyDialog({
  id,
  label,
  platform,
  mutations,
}: {
  id: string;
  label: string;
  platform: boolean;
  mutations: LlmMutations;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const recent = useRecentAuth();
  const secretId = useId();
  const { rotate } = mutations;
  const close = () => {
    setOpen(false);
    setSecret('');
    rotate.reset();
  };
  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
      trigger={
        <Button aria-label={`Rotate key for ${label}`}>
          <KeyRound size={14} aria-hidden="true" />
          Rotate
        </Button>
      }
      title={`Rotate key for ${label}`}
      description="The new key replaces the current one immediately. The old key can’t be recovered."
    >
      {!recent || isReauthError(rotate.error) ? (
        <StepUpNotice action="rotate this key" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            rotate.mutate({ id, secret, platform }, { onSuccess: close });
          }}
        >
          <Field id={secretId} label="New API key" hint="Encrypted before it is stored.">
            <SecretInput
              id={secretId}
              value={secret}
              required
              placeholder="Paste the new key"
              onChange={setSecret}
            />
          </Field>
          {errorText(rotate.error, 'The key could not be rotated.') && (
            <ErrorMessage>{errorText(rotate.error, 'The key could not be rotated.')}</ErrorMessage>
          )}
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button>Cancel</Button>
            </Dialog.Close>
            <Button type="submit" variant="primary" disabled={rotate.isPending || !secret}>
              {rotate.isPending ? 'Rotating…' : 'Rotate key'}
            </Button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}
