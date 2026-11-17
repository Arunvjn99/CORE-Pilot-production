import type { SelectedElement, SessionResponse } from '@core-studio/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, Maximize, Minus, Play, Plus, Settings2, X } from 'lucide-react';
import { Dialog, Tabs } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { Button, EmptyState, ErrorMessage } from '../../components/ui';
import { UserMenu } from '../../app/user-menu';
import { ApiError, apiSend } from '../../lib/api-client';
import { hasPermission } from '../auth/permissions';
import { useSession } from '../auth/use-session';
import { usePages, useProject, useProjectMutations } from '../projects/projects-api';
import { PageList } from '../projects/workspace/page-list';
import { SettingsSection } from '../projects/workspace/sections';
import { type Camera, Canvas, type Device, DEVICES, fitCamera, focusCamera } from './canvas';
import { ChatPanel } from './chat-panel';
import { PreviewFrame } from './preview-frame';
import { RightPanel } from './right-panel';
import { studioKeys, useScreens, useStudioConfig } from './studio-api';

const panelTab =
  'flex-1 border-b-2 border-transparent px-3 py-2 text-sm text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-text';
const iconButton =
  'rounded-md p-1.5 text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40';

/** `/projects/:projectId` — the design studio: chat + pages | canvas | design/prototype/verify. */
export function StudioRoute() {
  const { data: session } = useSession();
  const { projectId = '' } = useParams();
  if (!session) return null;
  if (!session.activeOrganizationId) return <Navigate to="/projects" replace />;
  return <Studio session={session} teamId={session.activeOrganizationId} projectId={projectId} />;
}

function Studio({
  session,
  teamId,
  projectId,
}: {
  session: SessionResponse;
  teamId: string;
  projectId: string;
}) {
  const project = useProject(teamId, projectId);
  const pages = usePages(teamId, projectId);
  const screens = useScreens(projectId);
  const config = useStudioConfig();
  const { open } = useProjectMutations(teamId);
  const client = useQueryClient();
  const viewport = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [camera, setCamera] = useState<Camera>({ x: 48, y: 48, zoom: 0.25 });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectedElement | null>(null);
  const [clearKey, setClearKey] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const opened = useRef<string | null>(null);
  const fitted = useRef(false);

  // Pages added, renamed or deleted in the Pages tab change the screens on the canvas.
  const pagesVersion = pages.dataUpdatedAt;
  const seenPages = useRef(0);
  useEffect(() => {
    if (!pagesVersion) return;
    if (seenPages.current)
      void client.invalidateQueries({ queryKey: studioKeys.screens(projectId) });
    seenPages.current = pagesVersion;
  }, [pagesVersion, client, projectId]);

  useEffect(() => {
    if (opened.current === projectId) return;
    opened.current = projectId;
    open.mutate(projectId);
  }, [projectId, open]);

  const screenList = screens.data?.screens ?? [];
  const fit = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect();
    if (rect) setCamera(fitCamera(screenList.length, device, rect));
  }, [screenList.length, device]);

  useEffect(() => {
    if (!fitted.current && screenList.length > 0) {
      fitted.current = true;
      fit();
    }
  }, [screenList.length, fit]);

  /** A page chosen in the Pages tab selects its screen and brings it into view. */
  const focusPage = (pageId: string) => {
    const index = screenList.findIndex((s) => s.pageId === pageId);
    const target = screenList[index];
    if (!target) return;
    setSelection(null);
    setClearKey((k) => k + 1);
    setSelectedPath(target.filePath);
    const rect = viewport.current?.getBoundingClientRect();
    if (rect) setCamera((current) => focusCamera(index, device, rect, current));
  };

  const checkpoint = useMutation({
    mutationFn: (message: string) =>
      apiSend('POST', `/api/v1/projects/${projectId}/checkpoints`, { body: { message } }),
  });

  if (project.isError) {
    const missing = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="mx-auto max-w-lg p-8">
        <EmptyState
          icon={<ArrowLeft size={28} />}
          title={missing ? 'Project not found' : 'Project could not be loaded'}
        >
          <Link to="/projects" className="text-accent underline">
            Back to projects
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (project.isPending || config.isPending) {
    return (
      <p role="status" className="p-8 text-sm text-text-muted">
        Opening project…
      </p>
    );
  }
  const data = project.data;
  const canWrite = hasPermission(session, 'projects:write') && data.status === 'active';
  const previewOrigin = config.data?.previewOrigin ?? '';
  const tokensCss = screens.data?.tokensCss ?? '';
  const playScreen = screenList.find((s) => s.route === playing);

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 md:px-3">
        <Link
          to="/projects"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Projects</span>
        </Link>
        <h1 className="min-w-0 truncate text-sm font-semibold">{data.name}</h1>
        {data.status === 'archived' && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
            Archived · read-only
          </span>
        )}
        <div className="mx-auto flex items-center gap-1" role="group" aria-label="Device">
          {(Object.keys(DEVICES) as Device[]).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              onClick={() => {
                setDevice(d);
                fitted.current = false;
              }}
              className={`rounded-md px-2 py-1 text-xs ${device === d ? 'bg-surface-muted font-semibold' : 'text-text-muted hover:bg-surface-muted'}`}
            >
              {DEVICES[d].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={iconButton}
            aria-label="Zoom out"
            onClick={() => {
              setCamera((c) => ({ ...c, zoom: Math.max(0.05, c.zoom / 1.25) }));
            }}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums" aria-live="polite">
            {Math.round(camera.zoom * 100)}%
          </span>
          <button
            type="button"
            className={iconButton}
            aria-label="Zoom in"
            onClick={() => {
              setCamera((c) => ({ ...c, zoom: Math.min(2, c.zoom * 1.25) }));
            }}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" className={iconButton} aria-label="Fit to screen" onClick={fit}>
            <Maximize size={16} aria-hidden="true" />
          </button>
          {canWrite && (
            <button
              type="button"
              className={iconButton}
              aria-label="Save checkpoint"
              title="Save checkpoint"
              disabled={checkpoint.isPending}
              onClick={() => {
                checkpoint.mutate(`Checkpoint ${new Date().toLocaleString()}`);
              }}
            >
              <Bookmark size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={iconButton}
            aria-label="Project settings"
            onClick={() => {
              setSettingsOpen(true);
            }}
          >
            <Settings2 size={16} aria-hidden="true" />
          </button>
          <Button
            variant="primary"
            onClick={() => {
              setPlaying(screenList[0]?.route ?? null);
            }}
            disabled={screenList.length === 0}
          >
            <Play size={14} aria-hidden="true" /> Play
          </Button>
          <UserMenu session={session} />
        </div>
      </header>
      {checkpoint.error && (
        <div className="px-3 pt-2">
          <ErrorMessage>
            {checkpoint.error instanceof ApiError ? checkpoint.error.message : 'Checkpoint failed.'}
          </ErrorMessage>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Assistant and pages"
          className="flex w-80 shrink-0 flex-col border-r border-border"
        >
          <Tabs.Root defaultValue="chat" className="flex min-h-0 flex-1 flex-col">
            <Tabs.List aria-label="Left panel" className="flex border-b border-border">
              <Tabs.Trigger value="chat" className={panelTab}>
                AI agents
              </Tabs.Trigger>
              <Tabs.Trigger value="pages" className={panelTab}>
                Pages
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="chat" className="min-h-0 flex-1">
              <ChatPanel projectId={projectId} canWrite={canWrite} />
            </Tabs.Content>
            <Tabs.Content value="pages" className="min-h-0 flex-1 overflow-y-auto p-3">
              {pages.data && (
                <PageList
                  teamId={teamId}
                  projectId={projectId}
                  pages={pages.data}
                  currentPageId={
                    screenList.find((s) => s.filePath === selectedPath)?.pageId ?? null
                  }
                  hrefFor={(pageId) => `/projects/${projectId}?page=${pageId}`}
                  canEdit={canWrite}
                  onNavigate={focusPage}
                />
              )}
            </Tabs.Content>
          </Tabs.Root>
        </aside>

        <main id="studio-canvas" ref={viewport} className="relative min-w-0 flex-1">
          {screens.isError && (
            <div className="p-4">
              <ErrorMessage>Screens could not be loaded.</ErrorMessage>
            </div>
          )}
          {screens.data && screenList.length === 0 && (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState icon={<Play size={28} />} title="No screens yet">
                Describe what you want in the AI agents panel and the team will design it here.
              </EmptyState>
            </div>
          )}
          {screens.data && screenList.length > 0 && previewOrigin && (
            <Canvas
              screens={screenList}
              tokensCss={tokensCss}
              previewOrigin={previewOrigin}
              device={device}
              camera={camera}
              onCamera={setCamera}
              selectedPath={selectedPath}
              onSelectScreen={(path) => {
                if (path !== selectedPath) {
                  setSelection(null);
                  setClearKey((k) => k + 1);
                }
                setSelectedPath(path);
              }}
              onSelectElement={setSelection}
              clearSelectionKey={clearKey}
            />
          )}
        </main>

        <aside aria-label="Inspector" className="w-80 shrink-0 border-l border-border">
          <RightPanel
            projectId={projectId}
            teamId={teamId}
            selection={selection}
            tokensCss={tokensCss}
            screens={screenList}
            revision={screens.data?.revision ?? 0}
            canWrite={canWrite}
            onPlay={() => {
              setPlaying(
                screenList.find((s) => s.filePath === selectedPath)?.route ??
                  screenList[0]?.route ??
                  null,
              );
            }}
            onEdited={() => {
              void client.invalidateQueries({ queryKey: studioKeys.screens(projectId) });
            }}
          />
        </aside>
      </div>

      <Dialog.Root
        open={playing !== null}
        onOpenChange={(o) => {
          if (!o) setPlaying(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/80" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-xl bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <Dialog.Title className="text-sm font-semibold">
                Prototype · {playScreen?.name ?? ''}{' '}
                <span className="font-mono text-text-muted">{playScreen?.route}</span>
              </Dialog.Title>
              <Dialog.Close aria-label="Close prototype" className={iconButton}>
                <X size={18} aria-hidden="true" />
              </Dialog.Close>
            </div>
            <div className="flex flex-1 items-start justify-center overflow-auto bg-canvas p-6">
              {playScreen && (
                <div className="shadow-xl" style={{ width: Math.min(DEVICES[device].width, 1440) }}>
                  <PreviewFrame
                    previewOrigin={previewOrigin}
                    path={playScreen.filePath}
                    code={playScreen.code}
                    tokensCss={tokensCss}
                    mode="play"
                    title={`Prototype: ${playScreen.name}`}
                    width={DEVICES[device].width}
                    height={DEVICES[device].height}
                    onNavigate={(route) => {
                      if (screenList.some((s) => s.route === route)) setPlaying(route);
                    }}
                  />
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(44rem,calc(100vw-2rem))] -translate-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl"
          >
            <Dialog.Title className="mb-4 text-lg font-semibold">Project settings</Dialog.Title>
            <SettingsSection
              project={data}
              teamId={teamId}
              canEdit={hasPermission(session, 'projects:write')}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
