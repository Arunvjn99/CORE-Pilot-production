import type { Project, ProjectPage, SessionResponse } from '@core-studio/contracts';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  X,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, useParams, useSearchParams } from 'react-router';
import { EmptyState, ErrorMessage } from '../../../components/ui';
import { UserMenu } from '../../../app/user-menu';
import { ApiError } from '../../../lib/api-client';
import { hasPermission } from '../../auth/permissions';
import { useSession } from '../../auth/use-session';
import { usePages, useProject, useProjectMutations } from '../projects-api';
import { PageList } from './page-list';
import {
  AssistantSection,
  CanvasSection,
  CodeSection,
  DesignSystemSection,
  isSection,
  SECTIONS,
  type SectionId,
  SettingsSection,
} from './sections';

/** `/projects/:projectId/:section?page=<id>` — the full-screen project workspace. */
export function WorkspaceRoute() {
  const { data: session } = useSession();
  const { projectId = '', section } = useParams();
  if (!session) return null;
  if (!session.activeOrganizationId) return <Navigate to="/projects" replace />;
  if (!isSection(section)) return <Navigate to={`/projects/${projectId}/canvas`} replace />;
  return (
    <Workspace
      session={session}
      teamId={session.activeOrganizationId}
      projectId={projectId}
      section={section}
    />
  );
}

function Workspace({
  session,
  teamId,
  projectId,
  section,
}: {
  session: SessionResponse;
  teamId: string;
  projectId: string;
  section: SectionId;
}) {
  const project = useProject(teamId, projectId);
  const pages = usePages(teamId, projectId);
  const { open } = useProjectMutations(teamId);
  const [searchParams] = useSearchParams();
  // Docked beside the canvas on wide screens; on tablets it overlays, so it starts closed.
  const [assistantOpen, setAssistantOpen] = useState(
    () =>
      typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1280px)').matches,
  );
  const [navOpen, setNavOpen] = useState(false);
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (opened.current === projectId) return;
    opened.current = projectId;
    open.mutate(projectId);
  }, [projectId, open]);

  if (project.isError) {
    const missing = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="mx-auto max-w-lg p-8">
        <EmptyState
          icon={<ArrowLeft size={28} />}
          title={missing ? 'Project not found' : 'Project could not be loaded'}
        >
          {missing
            ? 'It may belong to another team or the link is wrong.'
            : 'Try reloading the page.'}{' '}
          <Link to="/projects" className="text-accent underline">
            Back to projects
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (project.isPending) {
    return (
      <p role="status" className="p-8 text-sm text-text-muted">
        Opening project…
      </p>
    );
  }

  const data = project.data;
  const canEdit = hasPermission(session, 'projects:write') && data.status === 'active';
  const pageList = pages.data ?? [];
  const requested = searchParams.get('page');
  const currentPage = pageList.find((p) => p.id === requested) ?? pageList[0];
  const pageQuery = currentPage ? `?page=${currentPage.id}` : '';
  const hrefFor = (pageId: string) => `/projects/${projectId}/${section}?page=${pageId}`;
  const sectionLabel = SECTIONS.find((s) => s.id === section)?.label ?? '';

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-3">
      <nav aria-label="Workspace">
        <ul className="space-y-0.5">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <NavLink
                to={`/projects/${projectId}/${id}${pageQuery}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent ${isActive ? 'bg-surface-muted font-semibold' : 'text-text-muted hover:bg-surface-muted hover:text-text'}`
                }
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {pages.isError ? (
        <ErrorMessage>Pages could not be loaded.</ErrorMessage>
      ) : pages.isPending ? (
        <p role="status" className="px-2 text-sm text-text-muted">
          Loading pages…
        </p>
      ) : (
        <PageList
          teamId={teamId}
          projectId={projectId}
          pages={pageList}
          currentPageId={currentPage?.id ?? null}
          hrefFor={hrefFor}
          canEdit={canEdit}
          {...(onNavigate ? { onNavigate } : {})}
        />
      )}
    </div>
  );

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <a
        href="#workspace-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-2"
      >
        Skip to workspace
      </a>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 md:px-3">
        <ToolbarButton
          label="Show navigation"
          className="lg:hidden"
          onClick={() => {
            setNavOpen(true);
          }}
        >
          <PanelLeft size={18} aria-hidden="true" />
        </ToolbarButton>
        <Link
          to="/projects"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Projects</span>
        </Link>
        <ChevronRight size={14} aria-hidden="true" className="hidden text-text-muted sm:block" />
        <h1 className="min-w-0 truncate text-sm font-semibold">{data.name}</h1>
        {data.status === 'archived' && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
            Archived · read-only
          </span>
        )}
        <span className="hidden min-w-0 truncate text-sm text-text-muted md:inline">
          / {sectionLabel}
          {currentPage && section === 'canvas' ? ` / ${currentPage.name}` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton
            label={assistantOpen ? 'Hide AI assistant' : 'Show AI assistant'}
            pressed={assistantOpen}
            onClick={() => {
              setAssistantOpen((v) => !v);
            }}
          >
            {assistantOpen ? (
              <PanelRightClose size={18} aria-hidden="true" />
            ) : (
              <PanelRightOpen size={18} aria-hidden="true" />
            )}
          </ToolbarButton>
          <UserMenu session={session} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Project"
          className="hidden w-64 shrink-0 border-r border-border lg:block"
        >
          {sidebar()}
        </aside>
        <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-surface shadow-xl lg:hidden"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <Dialog.Title className="text-sm font-semibold">{data.name}</Dialog.Title>
                <Dialog.Close
                  aria-label="Close navigation"
                  className="rounded-md p-1 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <X size={18} aria-hidden="true" />
                </Dialog.Close>
              </div>
              {sidebar(() => {
                setNavOpen(false);
              })}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <main
          id="workspace-main"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto bg-surface p-4 md:p-6"
        >
          <SectionContent
            section={section}
            project={data}
            page={currentPage}
            teamId={teamId}
            canEdit={hasPermission(session, 'projects:write')}
          />
        </main>

        {assistantOpen && (
          <aside
            aria-label="AI assistant"
            className="fixed inset-y-12 right-0 z-30 flex w-80 max-w-[85vw] flex-col border-l border-border bg-surface shadow-xl xl:static xl:shadow-none"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Bot size={16} aria-hidden="true" />
                AI assistant
              </h2>
              <button
                type="button"
                aria-label="Close AI assistant"
                onClick={() => {
                  setAssistantOpen(false);
                }}
                className="rounded-md p-1 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent xl:hidden"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-1 flex-col justify-between gap-4 p-4 text-sm">
              <div className="space-y-2 text-text-muted">
                <p className="rounded-full border border-border px-2.5 py-0.5 text-center text-xs">
                  Not connected yet
                </p>
                <p>
                  The assistant will work on{' '}
                  <strong className="text-text">{currentPage?.name ?? data.name}</strong> once the
                  canvas edit loop exists. It will use your team’s default model from Settings → AI
                  providers.
                </p>
              </div>
              <label className="space-y-1">
                <span className="sr-only">Message the AI assistant (not available yet)</span>
                <textarea
                  disabled
                  rows={3}
                  placeholder="Ask the assistant… (coming soon)"
                  className="w-full resize-none rounded-md border border-border bg-surface-muted px-3 py-2 text-sm"
                />
              </label>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  pressed,
  className = '',
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onClick={onClick}
      className={`rounded-md p-1.5 text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent ${className}`}
    >
      {children}
    </button>
  );
}

function SectionContent({
  section,
  project,
  page,
  teamId,
  canEdit,
}: {
  section: SectionId;
  project: Project;
  page: ProjectPage | undefined;
  teamId: string;
  canEdit: boolean;
}) {
  switch (section) {
    case 'canvas':
      return <CanvasSection page={page} />;
    case 'code':
      return <CodeSection />;
    case 'assistant':
      return <AssistantSection />;
    case 'design-system':
      return <DesignSystemSection />;
    case 'settings':
      return <SettingsSection project={project} teamId={teamId} canEdit={canEdit} />;
  }
}
