import type { Folder, SessionResponse } from '@core-studio/contracts';
import { Clock, FileEdit, Folder as FolderIcon, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router';
import { hasPermission } from '../auth/permissions';
import { useSession } from '../auth/use-session';
import { DeleteProjectDialog, NameDialog } from './file-dialogs';
import { useFolderMutations, useFolders } from './files-api';

export interface FilesContext {
  session: SessionResponse;
  teamId: string;
  canWrite: boolean;
  folders: Folder[];
}

export const useFilesContext = () => useOutletContext<FilesContext>();

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent ${isActive ? 'bg-accent/10 font-semibold text-accent' : 'hover:bg-surface-muted'}`;

function Item({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex">
      <NavLink to={to} className={linkClass}>
        <span aria-hidden="true">{icon}</span>
        <span className="truncate">{children}</span>
      </NavLink>
    </li>
  );
}

/** `/files/*` — Figma-style file browser: Recents, Drafts, Projects, Trash. */
export function FilesLayout() {
  const { data: session } = useSession();
  if (!session?.activeOrganizationId) return null;
  return <Browser session={session} teamId={session.activeOrganizationId} />;
}

function Browser({ session, teamId }: { session: SessionResponse; teamId: string }) {
  const canWrite = hasPermission(session, 'projects:write');
  const folders = useFolders(teamId);
  const mutations = useFolderMutations(teamId);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Folder | null>(null);
  const [deleting, setDeleting] = useState<Folder | null>(null);
  const list = folders.data ?? [];

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside aria-label="Files" className="md:w-60 md:shrink-0">
        <nav aria-label="Files navigation" className="space-y-4">
          <ul className="space-y-0.5">
            <Item to="/files/recent" icon={<Clock size={16} />}>
              Recents
            </Item>
            <Item to="/files/drafts" icon={<FileEdit size={16} />}>
              Drafts
            </Item>
          </ul>
          <section aria-labelledby="projects-heading" className="space-y-1">
            <div className="flex items-center justify-between px-2">
              <h2
                id="projects-heading"
                className="text-xs font-semibold tracking-wide text-text-muted uppercase"
              >
                Projects
              </h2>
              {canWrite && (
                <button
                  type="button"
                  aria-label="New project"
                  className="rounded p-1 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => {
                    mutations.create.reset();
                    setCreating(true);
                  }}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            {folders.isError && (
              <p className="px-2 text-sm text-danger">Projects could not be loaded.</p>
            )}
            {folders.data && list.length === 0 && (
              <p className="px-2 text-sm text-text-muted">No projects yet.</p>
            )}
            <ul className="space-y-0.5">
              {list.map((folder) => (
                <li key={folder.id} className="group flex items-center gap-1">
                  <NavLink to={`/files/project/${folder.id}`} className={linkClass}>
                    <FolderIcon size={16} aria-hidden="true" className="shrink-0" />
                    <span className="truncate">{folder.name}</span>
                    <span
                      className="ml-auto text-xs text-text-muted"
                      aria-label={`${String(folder.fileCount)} files`}
                    >
                      {folder.fileCount}
                    </span>
                  </NavLink>
                  {canWrite && (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger
                        aria-label={`Actions for project ${folder.name}`}
                        className="rounded p-1 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <MoreHorizontal size={14} aria-hidden="true" />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align="end"
                          className="z-50 min-w-40 rounded-md border border-border bg-surface p-1 shadow-lg"
                        >
                          <DropdownMenu.Item
                            className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-muted"
                            onSelect={() => {
                              mutations.rename.reset();
                              setRenaming(folder);
                            }}
                          >
                            Rename
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            className="cursor-pointer rounded px-2 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-danger/10"
                            onSelect={() => {
                              mutations.remove.reset();
                              setDeleting(folder);
                            }}
                          >
                            Delete
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <ul>
            <Item to="/files/trash" icon={<Trash2 size={16} />}>
              Trash
            </Item>
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <Outlet context={{ session, teamId, canWrite, folders: list } satisfies FilesContext} />
      </div>

      {creating && (
        <NameDialog
          open
          onOpenChange={setCreating}
          title="New project"
          label="Project name"
          initial=""
          submitLabel="Create project"
          pending={mutations.create.isPending}
          error={mutations.create.error}
          onSubmit={(name) => {
            mutations.create.mutate(name, {
              onSuccess: (folder) => {
                setCreating(false);
                void navigate(`/files/project/${folder.id}`);
              },
            });
          }}
        />
      )}
      {renaming && (
        <NameDialog
          open
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
          title="Rename project"
          label="Project name"
          initial={renaming.name}
          submitLabel="Save"
          pending={mutations.rename.isPending}
          error={mutations.rename.error}
          onSubmit={(name) => {
            mutations.rename.mutate(
              { folder: renaming, name },
              {
                onSuccess: () => {
                  setRenaming(null);
                },
              },
            );
          }}
        />
      )}
      <DeleteProjectDialog
        folder={deleting}
        pending={mutations.remove.isPending}
        error={mutations.remove.error}
        onCancel={() => {
          setDeleting(null);
        }}
        onConfirm={() => {
          if (!deleting) return;
          mutations.remove.mutate(deleting, {
            onSuccess: () => {
              setDeleting(null);
              void navigate('/files/trash');
            },
          });
        }}
      />
    </div>
  );
}
