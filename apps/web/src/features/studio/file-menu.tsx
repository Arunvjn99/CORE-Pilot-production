import type { Project } from '@core-studio/contracts';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { MoveFileDialog, NameDialog } from '../files/file-dialogs';
import { useFileMutations, useFolders } from '../files/files-api';
import { exportUrl } from './studio-api';

/** Where "back" goes from a file: its project, or Drafts. */
export const browserPathOf = (file: Pick<Project, 'folderId' | 'status'>) =>
  file.status === 'archived'
    ? '/files/trash'
    : file.folderId
      ? `/files/project/${file.folderId}`
      : '/files/drafts';

const item =
  'cursor-pointer rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-muted data-[disabled]:cursor-default data-[disabled]:opacity-50';

/**
 * Editor breadcrumb `Project / File ▾` (Figma UI3). The file name opens the file menu:
 * rename, duplicate, move, version history, export, settings, move to trash.
 */
export function FileMenu({
  file,
  teamId,
  canWrite,
  onShowHistory,
  onOpenSettings,
}: {
  file: Project;
  teamId: string;
  canWrite: boolean;
  onShowHistory: () => void;
  onOpenSettings: () => void;
}) {
  const navigate = useNavigate();
  const mutations = useFileMutations(teamId);
  const folders = useFolders(teamId);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      <Link
        to={browserPathOf(file)}
        className="max-w-40 truncate rounded px-1.5 py-1 text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        {file.status === 'archived' ? 'Trash' : (file.folderName ?? 'Drafts')}
      </Link>
      <span aria-hidden="true" className="text-text-muted">
        /
      </span>
      <h1 className="min-w-0 text-sm font-semibold">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label={`${file.name}, file menu`}
            className="flex max-w-64 items-center gap-1 rounded px-1.5 py-1 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="truncate">{file.name}</span>
            <ChevronDown size={14} aria-hidden="true" className="shrink-0" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              className="z-50 min-w-52 rounded-md border border-border bg-surface p-1 shadow-lg"
            >
              <DropdownMenu.Item
                className={item}
                disabled={!canWrite}
                onSelect={() => {
                  mutations.rename.reset();
                  setRenaming(true);
                }}
              >
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={item}
                disabled={!canWrite}
                onSelect={() => {
                  setError(null);
                  mutations.duplicate.mutate(file, {
                    onSuccess: (copy) => {
                      void navigate(`/file/${copy.id}`);
                    },
                    onError: () => {
                      setError('The file could not be duplicated.');
                    },
                  });
                }}
              >
                Duplicate
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={item}
                disabled={!canWrite}
                onSelect={() => {
                  mutations.move.reset();
                  setMoving(true);
                }}
              >
                Move to…
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item className={item} onSelect={onShowHistory}>
                Version history
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={item}
                onSelect={() => {
                  window.location.assign(exportUrl(file.id));
                }}
              >
                Export React project
              </DropdownMenu.Item>
              <DropdownMenu.Item className={item} onSelect={onOpenSettings}>
                File settings
              </DropdownMenu.Item>
              {canWrite && (
                <>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item
                    className={`${item} text-danger data-[highlighted]:bg-danger/10`}
                    onSelect={() => {
                      setError(null);
                      mutations.trash.mutate(file, {
                        onSuccess: () => {
                          void navigate('/files/trash');
                        },
                        onError: () => {
                          setError('The file could not be moved to trash.');
                        },
                      });
                    }}
                  >
                    Move to trash
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </h1>
      {file.status === 'archived' && (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
          In trash · read-only
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}

      {renaming && (
        <NameDialog
          open
          onOpenChange={setRenaming}
          title="Rename file"
          label="File name"
          initial={file.name}
          submitLabel="Save"
          pending={mutations.rename.isPending}
          error={mutations.rename.error}
          onSubmit={(name) => {
            mutations.rename.mutate(
              { file, name },
              {
                onSuccess: () => {
                  setRenaming(false);
                },
              },
            );
          }}
        />
      )}
      {moving && (
        <MoveFileDialog
          open
          onOpenChange={setMoving}
          file={file}
          folders={folders.data ?? []}
          pending={mutations.move.isPending}
          error={mutations.move.error}
          onSubmit={(folderId) => {
            mutations.move.mutate(
              { file, folderId },
              {
                onSuccess: () => {
                  setMoving(false);
                },
              },
            );
          }}
        />
      )}
    </nav>
  );
}
