import type { Project } from '@core-studio/contracts';
import { Dialog } from 'radix-ui';
import { type ReactNode, useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';

export const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent';

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function FormDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(30rem,calc(100vw-2rem))] -translate-1/2 space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl"
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="text-sm text-text-muted">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Create or edit a project's name and description. */
export function ProjectForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  inDialog = true,
}: {
  initial?: Pick<Project, 'name' | 'description'>;
  /** Render a Cancel button that closes the surrounding dialog. */
  inDialog?: boolean;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (values: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const nameId = useId();
  const descriptionId = useId();
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name: name.trim(), description: description.trim() });
      }}
    >
      <div className="space-y-1">
        <label htmlFor={nameId} className="text-sm font-medium">
          Project name
        </label>
        <input
          id={nameId}
          required
          maxLength={80}
          autoComplete="off"
          className={inputClass}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={descriptionId} className="text-sm font-medium">
          Description <span className="font-normal text-text-muted">(optional)</span>
        </label>
        <textarea
          id={descriptionId}
          maxLength={500}
          rows={3}
          className={inputClass}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>
      {error ? (
        <ErrorMessage>{errorMessage(error, 'The project could not be saved.')}</ErrorMessage>
      ) : null}
      <div className="flex justify-end gap-2">
        {inDialog && (
          <Dialog.Close asChild>
            <Button>Cancel</Button>
          </Dialog.Close>
        )}
        <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
