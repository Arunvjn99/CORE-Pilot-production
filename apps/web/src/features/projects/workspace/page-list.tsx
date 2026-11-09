import { type ProjectPage, routeFromName } from '@core-studio/contracts';
import { FileText, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { AlertDialog, DropdownMenu } from 'radix-ui';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, ErrorMessage } from '../../../components/ui';
import { errorMessage, FormDialog, inputClass } from '../project-dialogs';
import { usePageMutations } from '../projects-api';

function PageForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Pick<ProjectPage, 'name' | 'route'>;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (values: { name: string; route: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [route, setRoute] = useState(initial?.route ?? '');
  const [routeEdited, setRouteEdited] = useState(Boolean(initial));
  const nameId = useId();
  const routeId = useId();
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name: name.trim(), route: route.trim() });
      }}
    >
      <div className="space-y-1">
        <label htmlFor={nameId} className="text-sm font-medium">
          Page name
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
            if (!routeEdited) setRoute(routeFromName(event.target.value));
          }}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={routeId} className="text-sm font-medium">
          Route
        </label>
        <input
          id={routeId}
          required
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${routeId}-hint`}
          className={`${inputClass} font-mono`}
          value={route}
          onChange={(event) => {
            setRoute(event.target.value);
            setRouteEdited(true);
          }}
        />
        <p id={`${routeId}-hint`} className="text-xs text-text-muted">
          The URL path in the app, e.g. <code>/pricing</code>. Lowercase letters, numbers and
          hyphens.
        </p>
      </div>
      {error ? (
        <ErrorMessage>{errorMessage(error, 'The page could not be saved.')}</ErrorMessage>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending || !name.trim() || !route.trim()}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Arrow keys move between pages (roving focus within the list). */
function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-page-link]')];
  const index = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (index === -1) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? links.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
  links[next]?.focus();
}

export function PageList({
  teamId,
  projectId,
  pages,
  currentPageId,
  hrefFor,
  canEdit,
  onNavigate,
}: {
  teamId: string;
  projectId: string;
  pages: ProjectPage[];
  currentPageId: string | null;
  hrefFor: (pageId: string) => string;
  canEdit: boolean;
  onNavigate?: () => void;
}) {
  const mutations = usePageMutations(teamId, projectId);
  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<ProjectPage | null>(null);
  const [deleting, setDeleting] = useState<ProjectPage | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  return (
    <section aria-labelledby="pages-heading" className="space-y-2">
      <div className="flex items-center justify-between px-2">
        <h2
          id="pages-heading"
          className="text-xs font-semibold tracking-wide text-text-muted uppercase"
        >
          Pages
        </h2>
        {canEdit && (
          <button
            type="button"
            aria-label="Add page"
            onClick={() => {
              setAddOpen(true);
            }}
            className="rounded-md p-1 text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <ul ref={listRef} onKeyDown={onListKeyDown} className="space-y-0.5">
        {pages.map((page) => {
          const current = page.id === currentPageId;
          return (
            <li key={page.id} className="group flex items-center gap-1">
              <Link
                data-page-link
                to={hrefFor(page.id)}
                onClick={onNavigate}
                aria-current={current ? 'page' : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent ${current ? 'bg-accent/10 font-semibold text-accent' : 'hover:bg-surface-muted'}`}
              >
                <FileText size={15} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{page.name}</span>
                <span className="ml-auto truncate font-mono text-xs text-text-muted">
                  {page.route}
                </span>
              </Link>
              {canEdit && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    aria-label={`Actions for page ${page.name}`}
                    className="rounded-md p-1 text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      className="z-50 min-w-36 rounded-md border border-border bg-surface p-1 text-sm shadow-lg"
                    >
                      <DropdownMenu.Item
                        onSelect={() => {
                          setRenaming(page);
                        }}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-surface-muted"
                      >
                        <Pencil size={14} aria-hidden="true" />
                        Rename
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={pages.length <= 1}
                        onSelect={() => {
                          setDeleting(page);
                        }}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-danger outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-danger/10"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
            </li>
          );
        })}
      </ul>

      <FormDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) mutations.create.reset();
        }}
        title="Add page"
        description="Pages become routes of the React app."
      >
        <PageForm
          submitLabel="Add page"
          pending={mutations.create.isPending}
          error={mutations.create.error}
          onCancel={() => {
            setAddOpen(false);
          }}
          onSubmit={(values) => {
            mutations.create.mutate(values, {
              onSuccess: () => {
                setAddOpen(false);
              },
            });
          }}
        />
      </FormDialog>

      <FormDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenaming(null);
            mutations.update.reset();
          }
        }}
        title="Rename page"
      >
        {renaming && (
          <PageForm
            initial={renaming}
            submitLabel="Save"
            pending={mutations.update.isPending}
            error={mutations.update.error}
            onCancel={() => {
              setRenaming(null);
            }}
            onSubmit={(values) => {
              mutations.update.mutate(
                { pageId: renaming.id, ...values, expectedUpdatedAt: renaming.updatedAt },
                {
                  onSuccess: () => {
                    setRenaming(null);
                  },
                },
              );
            }}
          />
        )}
      </FormDialog>

      <AlertDialog.Root
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            mutations.remove.reset();
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-1/2 space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
            <AlertDialog.Title className="text-lg font-semibold">
              Delete page “{deleting?.name}”?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-text-muted">
              The page and its route <code>{deleting?.route}</code> are removed from this project.
              This can’t be undone.
            </AlertDialog.Description>
            {mutations.remove.error ? (
              <ErrorMessage>
                {errorMessage(mutations.remove.error, 'The page could not be deleted.')}
              </ErrorMessage>
            ) : null}
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button>Cancel</Button>
              </AlertDialog.Cancel>
              <Button
                variant="danger"
                disabled={mutations.remove.isPending}
                onClick={() => {
                  if (!deleting) return;
                  mutations.remove.mutate(deleting.id, {
                    onSuccess: () => {
                      setDeleting(null);
                    },
                  });
                }}
              >
                {mutations.remove.isPending ? 'Deleting…' : 'Delete page'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
