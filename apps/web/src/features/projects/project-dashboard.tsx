import type { Project, ProjectStatus, SessionResponse } from '@core-studio/contracts';
import {
  Archive,
  ArchiveRestore,
  Clock,
  FileText,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import { DropdownMenu, Tabs } from 'radix-ui';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, EmptyState, ErrorMessage, PageHeader } from '../../components/ui';
import { hasPermission } from '../auth/permissions';
import { useSession } from '../auth/use-session';
import { SystemStatus } from '../system/system-status';
import { errorMessage, FormDialog, inputClass, ProjectForm } from './project-dialogs';
import { useProjectMutations, useProjects } from './projects-api';

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return 'just now';
}

export const workspacePath = (projectId: string) => `/projects/${projectId}/canvas`;

export function ProjectDashboard() {
  const { data: session } = useSession();
  if (!session?.activeOrganizationId) return null;
  return <Dashboard session={session} teamId={session.activeOrganizationId} />;
}

function Dashboard({ session, teamId }: { session: SessionResponse; teamId: string }) {
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [query, setQuery] = useState('');
  const canWrite = hasPermission(session, 'projects:write');
  const active = useProjects(teamId, 'active');
  const archived = useProjects(teamId, 'archived');
  const mutations = useProjectMutations(teamId);
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const current = status === 'active' ? active : archived;
  const needle = query.trim().toLowerCase();
  const filtered = (current.data ?? []).filter(
    (p) =>
      !needle ||
      p.name.toLowerCase().includes(needle) ||
      p.description.toLowerCase().includes(needle),
  );
  const recent = (active.data ?? [])
    .filter((p) => p.lastOpenedAt)
    .sort((a, b) => Date.parse(b.lastOpenedAt ?? '') - Date.parse(a.lastOpenedAt ?? ''))
    .slice(0, 4);

  const createButton = canWrite ? (
    <FormDialog
      open={createOpen}
      onOpenChange={(open) => {
        setCreateOpen(open);
        if (!open) mutations.create.reset();
      }}
      title="New project"
      description="A project is a React app your team designs in the canvas. It starts with a Home page."
      trigger={
        <Button variant="primary">
          <Plus size={16} aria-hidden="true" />
          New project
        </Button>
      }
    >
      <ProjectForm
        submitLabel="Create project"
        pending={mutations.create.isPending}
        error={mutations.create.error}
        onSubmit={(values) => {
          mutations.create.mutate(values, {
            onSuccess: (project) => {
              setCreateOpen(false);
              void navigate(workspacePath(project.id));
            },
          });
        }}
      />
    </FormDialog>
  ) : null;

  const noProjectsAtAll = active.data?.length === 0 && archived.data?.length === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        description="React applications your team designs and edits in the canvas."
        actions={createButton}
      />

      {active.isError && (
        <ErrorMessage>Projects could not be loaded. Try reloading the page.</ErrorMessage>
      )}
      {active.isPending && <ProjectGridSkeleton />}

      {noProjectsAtAll && (
        <EmptyState icon={<FolderKanban size={32} />} title="No projects yet">
          {canWrite
            ? 'Create your first project to open its workspace and start adding pages.'
            : 'When someone in your team creates a project it appears here.'}
        </EmptyState>
      )}

      {recent.length > 0 && status === 'active' && !needle && (
        <section aria-labelledby="recent-heading" className="space-y-3">
          <h2
            id="recent-heading"
            className="flex items-center gap-2 text-sm font-semibold text-text-muted"
          >
            <Clock size={16} aria-hidden="true" />
            Recently opened
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {recent.map((project) => (
              <li key={project.id}>
                <Link
                  to={workspacePath(project.id)}
                  className="flex flex-col rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="truncate font-medium">{project.name}</span>
                  <span className="text-xs text-text-muted">
                    Opened {timeAgo(project.lastOpenedAt ?? project.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!noProjectsAtAll && active.data && (
        <Tabs.Root
          value={status}
          onValueChange={(value) => {
            setStatus(value as ProjectStatus);
          }}
          className="space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs.List aria-label="Project status" className="flex gap-1 border-b border-border">
              {(['active', 'archived'] as const).map((value) => (
                <Tabs.Trigger
                  key={value}
                  value={value}
                  className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-text"
                >
                  {value === 'active' ? 'All projects' : 'Archived'} (
                  {(value === 'active' ? active.data : archived.data)?.length ?? 0})
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <div className="relative w-full sm:w-72">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute top-2.5 left-3 text-text-muted"
              />
              <input
                type="search"
                aria-label="Search projects"
                placeholder="Search projects"
                className={`${inputClass} pl-9`}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
          </div>
          {(['active', 'archived'] as const).map((value) => (
            <Tabs.Content key={value} value={value}>
              {current.isPending ? (
                <ProjectGridSkeleton />
              ) : filtered.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-text-muted">
                  {needle
                    ? `No projects match “${query.trim()}”.`
                    : value === 'archived'
                      ? 'No archived projects.'
                      : 'No active projects. Restore one from Archived or create a new project.'}
                </p>
              ) : (
                <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      teamId={teamId}
                      canWrite={canWrite}
                    />
                  ))}
                </ul>
              )}
            </Tabs.Content>
          ))}
        </Tabs.Root>
      )}
      <SystemStatus />
    </div>
  );
}

function ProjectGridSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading projects"
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-xl border border-border bg-surface-muted motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

function ProjectCard({
  project,
  teamId,
  canWrite,
}: {
  project: Project;
  teamId: string;
  canWrite: boolean;
}) {
  const { update } = useProjectMutations(teamId);
  const [renameOpen, setRenameOpen] = useState(false);
  const archived = project.status === 'archived';
  const headingId = `project-${project.id}`;

  return (
    <li
      aria-labelledby={headingId}
      className="group relative flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors focus-within:border-accent hover:border-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id={headingId} className="min-w-0 font-semibold">
          {archived ? (
            <span className="block truncate">{project.name}</span>
          ) : (
            <Link
              to={workspacePath(project.id)}
              className="block truncate after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
            >
              {project.name}
            </Link>
          )}
        </h3>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${archived ? 'border-border text-text-muted' : 'border-success/40 bg-success/10 text-success'}`}
        >
          {archived ? 'Archived' : 'Active'}
        </span>
      </div>
      <p
        className={`line-clamp-2 min-h-10 text-sm ${project.description ? '' : 'text-text-muted italic'}`}
      >
        {project.description || 'No description'}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 text-xs text-text-muted">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <FileText size={14} aria-hidden="true" />
            {project.pageCount} {project.pageCount === 1 ? 'page' : 'pages'}
          </span>
          <time dateTime={project.updatedAt} title={absolute.format(new Date(project.updatedAt))}>
            Modified {timeAgo(project.updatedAt)}
          </time>
        </span>
        {canWrite && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              aria-label={`Actions for ${project.name}`}
              className="relative z-10 rounded-md p-1 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
            >
              <MoreHorizontal size={18} aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-30 min-w-40 rounded-md border border-border bg-surface p-1 text-sm shadow-lg"
              >
                {!archived && (
                  <DropdownMenu.Item
                    onSelect={() => {
                      setRenameOpen(true);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-surface-muted"
                  >
                    <Pencil size={14} aria-hidden="true" />
                    Rename
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item
                  onSelect={() => {
                    update.mutate({
                      id: project.id,
                      status: archived ? 'active' : 'archived',
                      expectedUpdatedAt: project.updatedAt,
                    });
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-surface-muted"
                >
                  {archived ? (
                    <ArchiveRestore size={14} aria-hidden="true" />
                  ) : (
                    <Archive size={14} aria-hidden="true" />
                  )}
                  {archived ? 'Restore' : 'Archive'}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
      {update.error && !renameOpen ? (
        <p role="alert" className="relative z-10 text-xs text-danger">
          {errorMessage(update.error, 'The change could not be saved.')}
        </p>
      ) : null}
      <FormDialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) update.reset();
        }}
        title="Rename project"
      >
        <ProjectForm
          initial={project}
          submitLabel="Save"
          pending={update.isPending}
          error={update.error}
          onSubmit={(values) => {
            update.mutate(
              { id: project.id, ...values, expectedUpdatedAt: project.updatedAt },
              {
                onSuccess: () => {
                  setRenameOpen(false);
                },
              },
            );
          }}
        />
      </FormDialog>
    </li>
  );
}
