import type { Folder, Project } from '@core-studio/contracts';
import { AlertDialog } from 'radix-ui';
import { useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { errorMessage, FormDialog, inputClass } from '../projects/project-dialogs';
import { useDesignSystems } from '../studio/studio-api';

const DRAFTS = '';

function Actions({
  pending,
  submitLabel,
  onCancel,
}: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button onClick={onCancel}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </div>
  );
}

function FolderSelect({
  id,
  folders,
  value,
  onChange,
}: {
  id: string;
  folders: Folder[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      id={id}
      className={inputClass}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      <option value={DRAFTS}>Drafts</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

/** New design file: name, project (or Drafts) and design system. */
export function NewFileDialog({
  open,
  onOpenChange,
  teamId,
  folders,
  defaultFolderId,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  folders: Folder[];
  defaultFolderId: string | null;
  pending: boolean;
  error: unknown;
  onSubmit: (values: { name: string; folderId: string | null; designSystem: string }) => void;
}) {
  const systems = useDesignSystems(teamId);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(defaultFolderId ?? DRAFTS);
  const [system, setSystem] = useState('core-2');
  const ids = { name: useId(), folder: useId(), system: useId() };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New design file">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onSubmit({ name: name.trim(), folderId: folder || null, designSystem: system });
        }}
      >
        <div className="space-y-1">
          <label htmlFor={ids.name} className="text-sm font-medium">
            File name
          </label>
          <input
            id={ids.name}
            className={inputClass}
            value={name}
            maxLength={80}
            required
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.folder} className="text-sm font-medium">
            Project
          </label>
          <FolderSelect id={ids.folder} folders={folders} value={folder} onChange={setFolder} />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.system} className="text-sm font-medium">
            Design system
          </label>
          <select
            id={ids.system}
            className={inputClass}
            value={system}
            onChange={(event) => {
              setSystem(event.target.value);
            }}
          >
            {(systems.data ?? [{ slug: 'core-2', name: 'CORE 2.0' }]).map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <ErrorMessage>{errorMessage(error, 'The file could not be created.')}</ErrorMessage>
        ) : null}
        <Actions
          pending={pending}
          submitLabel="Create file"
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      </form>
    </FormDialog>
  );
}

/** One text field: rename a file or a project, or create a project. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const id = useId();
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <div className="space-y-1">
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          <input
            id={id}
            className={inputClass}
            value={name}
            maxLength={80}
            required
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        {error ? (
          <ErrorMessage>{errorMessage(error, 'The change could not be saved.')}</ErrorMessage>
        ) : null}
        <Actions
          pending={pending}
          submitLabel={submitLabel}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      </form>
    </FormDialog>
  );
}

export function MoveFileDialog({
  open,
  onOpenChange,
  file,
  folders,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: Project;
  folders: Folder[];
  pending: boolean;
  error: unknown;
  onSubmit: (folderId: string | null) => void;
}) {
  const [folder, setFolder] = useState(file.folderId ?? DRAFTS);
  const id = useId();
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={`Move “${file.name}”`}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(folder || null);
        }}
      >
        <div className="space-y-1">
          <label htmlFor={id} className="text-sm font-medium">
            Project
          </label>
          <FolderSelect id={id} folders={folders} value={folder} onChange={setFolder} />
        </div>
        {error ? (
          <ErrorMessage>{errorMessage(error, 'The file could not be moved.')}</ErrorMessage>
        ) : null}
        <Actions
          pending={pending}
          submitLabel="Move"
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      </form>
    </FormDialog>
  );
}

export function DeleteProjectDialog({
  folder,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  folder: Folder | null;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const count = folder?.fileCount ?? 0;
  return (
    <AlertDialog.Root
      open={folder !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-1/2 space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
          <AlertDialog.Title className="text-lg font-semibold">
            Delete project “{folder?.name}”?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-text-muted">
            {count === 0
              ? 'The project is empty.'
              : `Its ${String(count)} ${count === 1 ? 'file moves' : 'files move'} to Trash, where you can restore them into Drafts.`}
          </AlertDialog.Description>
          {error ? (
            <ErrorMessage>{errorMessage(error, 'The project could not be deleted.')}</ErrorMessage>
          ) : null}
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button>Cancel</Button>
            </AlertDialog.Cancel>
            <Button variant="danger" disabled={pending} onClick={onConfirm}>
              {pending ? 'Deleting…' : 'Delete project'}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
