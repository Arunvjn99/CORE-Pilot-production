import type { Project, ProjectSort } from '@core-studio/contracts';
import {
  Clock,
  FileEdit,
  FolderOpen,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Button, EmptyState, ErrorMessage, PageHeader } from '../../components/ui';
import { timeAgo } from '../../lib/time';
import { exportUrl } from '../studio/studio-api';
import { MoveFileDialog, NameDialog, NewFileDialog } from './file-dialogs';
import { type FileQuery, useFileMutations, useFiles } from './files-api';
import { useFilesContext } from './files-layout';

export type FilesMode = 'recent' | 'drafts' | 'project' | 'trash';

/** The editor of a file. */
export const filePath = (id: string) => `/file/${id}`;

const SORTS: { value: ProjectSort; label: string }[] = [
  { value: 'updated', label: 'Last modified' },
  { value: 'opened', label: 'Last opened' },
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Date created' },
];

type Layout = 'grid' | 'list';
const LAYOUT_KEY = 'core.files.layout';
const readLayout = (): Layout => {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};

const menuItem =
  'cursor-pointer rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-muted';

/** `/files/recent`, `/files/drafts`, `/files/project/:folderId`, `/files/trash`. */
export function FilesView({ mode }: { mode: FilesMode }) {
  const { teamId, canWrite, folders } = useFilesContext();
  const { folderId } = useParams();
  const navigate = useNavigate();
  const folder = mode === 'project' ? folders.find((f) => f.id === folderId) : undefined;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProjectSort>(mode === 'recent' ? 'opened' : 'updated');
  const [layout, setLayout] = useState<Layout>(readLayout);
  const query: FileQuery = {
    status: mode === 'trash' ? 'archived' : 'active',
    folder: mode === 'drafts' ? 'drafts' : mode === 'project' ? folderId : undefined,
    q: search.trim() || undefined,
    sort,
  };
  const files = useFiles(teamId, query);
  const mutations = useFileMutations(teamId);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [moving, setMoving] = useState<Project | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);

  // A project that was deleted (or belongs to another team) has no page here.
  if (mode === 'project' && folders.length > 0 && !folder)
    return <Navigate to="/files/recent" replace />;

  const title = {
    recent: 'Recents',
    drafts: 'Drafts',
    trash: 'Trash',
    project: folder?.name ?? '',
  }[mode];
  const icon = {
    recent: <Clock size={28} />,
    drafts: <FileEdit size={28} />,
    trash: <Trash2 size={28} />,
    project: <FolderOpen size={28} />,
  }[mode];
  const empty = {
    recent: 'Files you create or open appear here.',
    drafts: 'Files that are not in a project live here.',
    trash: 'Files you move to trash can be restored from here.',
    project: 'This project has no files yet.',
  }[mode];

  const trash = (file: Project) => {
    mutations.trash.mutate(file, {
      onSuccess: (trashed) => {
        setNotice({
          text: `“${file.name}” moved to trash.`,
          undo: () => {
            mutations.restore.mutate(trashed);
            setNotice(null);
          },
        });
      },
      onError: () => {
        setNotice({ text: `“${file.name}” could not be moved to trash.` });
      },
    });
  };
  const actions = (file: Project): { label: string; run: () => void; danger?: boolean }[] =>
    mode === 'trash'
      ? canWrite
        ? [
            {
              label: 'Restore',
              run: () => {
                mutations.restore.mutate(file, {
                  onSuccess: () => {
                    setNotice({ text: `“${file.name}” restored.` });
                  },
                  onError: () => {
                    setNotice({
                      text: `“${file.name}” could not be restored. A file with this name may already exist.`,
                    });
                  },
                });
              },
            },
          ]
        : []
      : [
          {
            label: 'Open',
            run: () => {
              void navigate(filePath(file.id));
            },
          },
          ...(canWrite
            ? [
                {
                  label: 'Rename',
                  run: () => {
                    mutations.rename.reset();
                    setRenaming(file);
                  },
                },
                {
                  label: 'Duplicate',
                  run: () => {
                    mutations.duplicate.mutate(file, {
                      onSuccess: (copy) => {
                        setNotice({ text: `Duplicated as “${copy.name}”.` });
                      },
                      onError: () => {
                        setNotice({ text: `“${file.name}” could not be duplicated.` });
                      },
                    });
                  },
                },
                {
                  label: 'Move to…',
                  run: () => {
                    mutations.move.reset();
                    setMoving(file);
                  },
                },
              ]
            : []),
          {
            label: 'Export',
            run: () => {
              window.location.assign(exportUrl(file.id));
            },
          },
          ...(canWrite
            ? [
                {
                  label: 'Move to trash',
                  run: () => {
                    trash(file);
                  },
                  danger: true,
                },
              ]
            : []),
        ];

  const onCardKey = (event: KeyboardEvent, file: Project) => {
    if (!canWrite || mode === 'trash') return;
    if (event.key === 'F2') {
      event.preventDefault();
      setRenaming(file);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      trash(file);
    }
  };

  const menu = (file: Project, trigger: ReactNode) => {
    const items = actions(file);
    if (items.length === 0) return null;
    return (
      <DropdownMenu.Root
        open={menuFor === file.id}
        onOpenChange={(open) => {
          setMenuFor(open ? file.id : null);
        }}
      >
        <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-lg"
          >
            {items.map((item) => (
              <DropdownMenu.Item
                key={item.label}
                className={`${menuItem} ${item.danger ? 'text-danger data-[highlighted]:bg-danger/10' : ''}`}
                onSelect={item.run}
              >
                {item.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    );
  };
  const menuButton = (file: Project) => (
    <button
      type="button"
      aria-label={`Actions for ${file.name}`}
      className="rounded p-1 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
    >
      <MoreHorizontal size={16} aria-hidden="true" />
    </button>
  );
  const meta = (file: Project) =>
    [
      mode !== 'project' ? (file.folderName ?? 'Drafts') : null,
      `${String(file.pageCount)} ${file.pageCount === 1 ? 'screen' : 'screens'}`,
      `Edited ${timeAgo(file.updatedAt)}`,
    ]
      .filter(Boolean)
      .join(' · ');
  const name = (file: Project) =>
    mode === 'trash' ? (
      <span className="truncate font-medium">{file.name}</span>
    ) : (
      <Link
        to={filePath(file.id)}
        onKeyDown={(event) => {
          onCardKey(event, file);
        }}
        className="truncate font-medium after:absolute after:inset-0 focus-visible:outline-none"
      >
        {file.name}
      </Link>
    );

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        actions={
          canWrite && mode !== 'trash' ? (
            <Button
              variant="primary"
              onClick={() => {
                mutations.create.reset();
                setCreating(true);
              }}
            >
              <Plus size={16} aria-hidden="true" /> New design file
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search files</span>
          <Search
            size={14}
            aria-hidden="true"
            className="absolute top-1/2 left-2.5 -translate-y-1/2 text-text-muted"
          />
          <input
            type="search"
            value={search}
            maxLength={80}
            placeholder="Search files"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            className="w-full rounded-md border border-border bg-surface py-1.5 pr-3 pl-8 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-text-muted">Sort</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as ProjectSort);
            }}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div
          role="group"
          aria-label="Layout"
          className="ml-auto flex rounded-md border border-border"
        >
          {(['grid', 'list'] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={layout === l}
              aria-label={l === 'grid' ? 'Grid' : 'List'}
              className={`p-1.5 focus-visible:outline-2 focus-visible:outline-accent ${layout === l ? 'bg-surface-muted' : ''}`}
              onClick={() => {
                setLayout(l);
                try {
                  window.localStorage.setItem(LAYOUT_KEY, l);
                } catch {
                  // Preference only.
                }
              }}
            >
              {l === 'grid' ? (
                <LayoutGrid size={16} aria-hidden="true" />
              ) : (
                <List size={16} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {notice && (
          <>
            {notice.text}{' '}
            {notice.undo && (
              <button
                type="button"
                className="font-medium text-accent underline"
                onClick={notice.undo}
              >
                Undo
              </button>
            )}
          </>
        )}
      </p>

      {files.isError && <ErrorMessage>Files could not be loaded.</ErrorMessage>}
      {files.data && files.data.length === 0 && (
        <EmptyState icon={icon} title={search ? 'No matching files' : `No files in ${title}`}>
          {search ? 'Try another name.' : empty}
        </EmptyState>
      )}
      {files.data && files.data.length > 0 && layout === 'grid' && (
        <ul
          aria-label={`${title} files`}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {files.data.map((file) => (
            <li
              key={file.id}
              aria-label={file.name}
              className="group relative overflow-hidden rounded-xl border border-border bg-surface focus-within:ring-2 focus-within:ring-accent hover:shadow-md"
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuFor(file.id);
              }}
            >
              <div
                aria-hidden="true"
                className="flex h-32 items-end bg-gradient-to-br from-accent/15 to-surface-muted p-3"
              >
                <span className="rounded bg-surface/80 px-1.5 py-0.5 text-xs text-text-muted">
                  {file.designSystemSlug ?? 'core-2'}
                </span>
              </div>
              <div className="flex items-start gap-2 p-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex min-w-0">{name(file)}</p>
                  <p className="truncate text-xs text-text-muted">{meta(file)}</p>
                </div>
                <div className="relative z-10">{menu(file, menuButton(file))}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {files.data && files.data.length > 0 && layout === 'list' && (
        <ul
          aria-label={`${title} files`}
          className="divide-y divide-border rounded-xl border border-border"
        >
          {files.data.map((file) => (
            <li
              key={file.id}
              aria-label={file.name}
              className="relative flex items-center gap-3 px-3 py-2 focus-within:bg-surface-muted hover:bg-surface-muted"
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuFor(file.id);
              }}
            >
              <p className="flex min-w-0 flex-1">{name(file)}</p>
              <p className="hidden truncate text-xs text-text-muted sm:block">{meta(file)}</p>
              <div className="relative z-10">{menu(file, menuButton(file))}</div>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewFileDialog
          open
          onOpenChange={setCreating}
          teamId={teamId}
          folders={folders}
          defaultFolderId={mode === 'project' ? (folderId ?? null) : null}
          pending={mutations.create.isPending}
          error={mutations.create.error}
          onSubmit={({ name: fileName, folderId: target, designSystem }) => {
            mutations.create.mutate(
              { input: { name: fileName, description: '', folderId: target }, designSystem },
              {
                onSuccess: (file) => {
                  setCreating(false);
                  void navigate(filePath(file.id));
                },
              },
            );
          }}
        />
      )}
      {renaming && (
        <NameDialog
          open
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
          title="Rename file"
          label="File name"
          initial={renaming.name}
          submitLabel="Save"
          pending={mutations.rename.isPending}
          error={mutations.rename.error}
          onSubmit={(newName) => {
            mutations.rename.mutate(
              { file: renaming, name: newName },
              {
                onSuccess: () => {
                  setRenaming(null);
                },
              },
            );
          }}
        />
      )}
      {moving && (
        <MoveFileDialog
          open
          onOpenChange={(open) => {
            if (!open) setMoving(null);
          }}
          file={moving}
          folders={folders}
          pending={mutations.move.isPending}
          error={mutations.move.error}
          onSubmit={(target) => {
            mutations.move.mutate(
              { file: moving, folderId: target },
              {
                onSuccess: () => {
                  setMoving(null);
                },
              },
            );
          }}
        />
      )}
    </div>
  );
}
