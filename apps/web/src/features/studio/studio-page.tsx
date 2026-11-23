import type { LayerNode, SelectedElement, SessionResponse } from '@core-studio/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bookmark,
  Download,
  Maximize,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Redo2,
  Undo2,
  Play,
  Plus,
  Settings2,
  X,
} from 'lucide-react';
import { Dialog, Tabs } from 'radix-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { Button, EmptyState, ErrorMessage } from '../../components/ui';
import { UserMenu } from '../../app/user-menu';
import { ApiError } from '../../lib/api-client';
import { hasPermission } from '../auth/permissions';
import { useSession } from '../auth/use-session';
import {
  usePageMutations,
  usePages,
  useProject,
  useProjectMutations,
} from '../projects/projects-api';
import { PageList } from '../projects/workspace/page-list';
import { SettingsSection } from '../projects/workspace/sections';
import {
  type Camera,
  Canvas,
  type CanvasPin,
  type Device,
  DEVICES,
  fitCamera,
  focusCamera,
} from './canvas';
import {
  CanvasToolbar,
  type Tool,
  type ToolbarActions,
  useEditorShortcuts,
} from './canvas-toolbar';
import { ChatPanel } from './chat-panel';
import { useComments } from './comments-api';
import { CommentsPanel, type PendingPin } from './comments-panel';
import { useEditHistory } from './edit-history';
import { FileMenu } from './file-menu';
import { AssetsPanel, LayersTree } from './layers-panel';
import { PreviewFrame } from './preview-frame';
import { RightPanel } from './right-panel';
import { HistoryPanel } from './history-panel';
import {
  exportUrl,
  studioKeys,
  useCheckpointMutations,
  useScreens,
  useStudioConfig,
} from './studio-api';

const panelTab =
  'flex-1 border-b-2 border-transparent px-1 py-2 text-xs text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-text';
const iconButton =
  'rounded-md p-1.5 text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40';

/** Old editor links (`/projects/:id?page=…`) keep working. */
export function LegacyFileRedirect() {
  const { projectId = '' } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/file/${projectId}${search}`} replace />;
}

/** `/file/:projectId` — the editor (Figma UI3): layers · AI · history | canvas | design/prototype/verify. */
export function StudioRoute() {
  const { data: session } = useSession();
  const { projectId = '' } = useParams();
  if (!session) return null;
  if (!session.activeOrganizationId) return <Navigate to="/files" replace />;
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
  /** Screens visited in Present mode, for "back"; and the transition into the current one. */
  const [playHistory, setPlayHistory] = useState<string[]>([]);
  const [playTransition, setPlayTransition] = useState<{ kind: 'instant' | 'dissolve'; n: number }>(
    {
      kind: 'instant',
      n: 0,
    },
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftTab, setLeftTab] = useState('ai');
  const [panels, setPanels] = useState(true);
  const [tool, setTool] = useState<Tool>('move');
  const [includeResolved, setIncludeResolved] = useState(false);
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [trees, setTrees] = useState<Record<string, LayerNode[]>>({});
  const [selectRequest, setSelectRequest] = useState<{
    path: string;
    line: number;
    column: number;
    nonce: number;
  } | null>(null);
  const comments = useComments(projectId, includeResolved);
  const pageMutations = usePageMutations(teamId, projectId);
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

  const checkpoint = useCheckpointMutations(projectId).save;
  const writable = hasPermission(session, 'projects:write') && project.data?.status === 'active';

  const history = useEditHistory(projectId, screenList, screens.data?.revision ?? 0);
  const pinned = (comments.data ?? []).filter(
    (t) => t.pageId !== null && t.x !== null && t.y !== null,
  );
  const pins: CanvasPin[] = [
    ...pinned.map((t, i) => ({
      id: t.id,
      pageId: t.pageId ?? '',
      x: t.x ?? 0,
      y: t.y ?? 0,
      number: i + 1,
      label: `Comment ${String(i + 1)} by ${t.authorName ?? 'former member'}: ${t.body.slice(0, 40)}`,
      active: t.id === activeComment,
      resolved: t.resolvedAt !== null,
    })),
    ...(pendingPin
      ? [
          {
            id: 'pending',
            ...pendingPin,
            number: 0,
            label: 'New comment',
            active: true,
            resolved: false,
            pending: true,
          },
        ]
      : []),
  ];

  const actions: ToolbarActions = {
    setTool,
    undo: () => {
      if (writable) history.undo();
    },
    redo: () => {
      if (writable) history.redo();
    },
    fit,
    zoomIn: () => {
      setCamera((c) => ({ ...c, zoom: Math.min(2, c.zoom * 1.25) }));
    },
    zoomOut: () => {
      setCamera((c) => ({ ...c, zoom: Math.max(0.05, c.zoom / 1.25) }));
    },
    togglePanels: () => {
      setPanels((p) => !p);
    },
    clearSelection: () => {
      setSelection(null);
      setClearKey((k) => k + 1);
      setPendingPin(null);
    },
    askAi: () => {
      setPanels(true);
      setLeftTab('ai');
      requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>('#studio-left textarea')?.focus();
      });
    },
    // Like Figma's frame tool: a new, empty screen with the next free name and route.
    addScreen: () => {
      if (!writable || pageMutations.create.isPending) return;
      const routes = new Set((pages.data ?? []).map((p) => p.route));
      let n = (pages.data?.length ?? 0) + 1;
      while (routes.has(`/screen-${String(n)}`)) n += 1;
      pageMutations.create.mutate(
        { name: `Screen ${String(n)}`, route: `/screen-${String(n)}` },
        {
          onSuccess: () => {
            setPanels(true);
            setLeftTab('layers');
            fitted.current = false; // fit again once the new screen arrives
          },
        },
      );
    },
  };
  useEditorShortcuts(actions, tool, writable);

  if (project.isError) {
    const missing = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="mx-auto max-w-lg p-8">
        <EmptyState
          icon={<ArrowLeft size={28} />}
          title={missing ? 'File not found' : 'File could not be loaded'}
        >
          <Link to="/files" className="text-accent underline">
            Back to files
          </Link>
        </EmptyState>
      </div>
    );
  }
  if (project.isPending || config.isPending) {
    return (
      <p role="status" className="p-8 text-sm text-text-muted">
        Opening file…
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
        <button
          type="button"
          className={iconButton}
          aria-label={panels ? 'Hide panels' : 'Show panels'}
          title={`${panels ? 'Hide' : 'Show'} panels (Ctrl+\\)`}
          aria-pressed={!panels}
          onClick={actions.togglePanels}
        >
          {panels ? (
            <PanelLeftClose size={16} aria-hidden="true" />
          ) : (
            <PanelLeftOpen size={16} aria-hidden="true" />
          )}
        </button>
        <FileMenu
          file={data}
          teamId={teamId}
          canWrite={canWrite}
          onShowHistory={() => {
            setPanels(true);
            setLeftTab('history');
          }}
          onOpenSettings={() => {
            setSettingsOpen(true);
          }}
        />
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
          {canWrite && (
            <>
              <button
                type="button"
                className={iconButton}
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
                disabled={!history.canUndo}
                onClick={history.undo}
              >
                <Undo2 size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={iconButton}
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                disabled={!history.canRedo}
                onClick={history.redo}
              >
                <Redo2 size={16} aria-hidden="true" />
              </button>
            </>
          )}
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
          <a
            href={exportUrl(projectId)}
            download
            className={iconButton}
            aria-label="Export React project"
            title="Export React project"
          >
            <Download size={16} aria-hidden="true" />
          </a>
          <button
            type="button"
            className={iconButton}
            aria-label="File settings"
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
            <Play size={14} aria-hidden="true" /> Present
          </Button>
          <UserMenu session={session} />
        </div>
      </header>
      {history.message && (
        <p role="status" className="px-3 pt-2 text-sm text-text-muted">
          {history.message}
        </p>
      )}
      {checkpoint.error && (
        <div className="px-3 pt-2">
          <ErrorMessage>
            {checkpoint.error instanceof ApiError ? checkpoint.error.message : 'Checkpoint failed.'}
          </ErrorMessage>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {panels && (
          <aside
            id="studio-left"
            aria-label="File panel"
            className="flex w-80 shrink-0 flex-col border-r border-border"
          >
            <Tabs.Root
              value={leftTab}
              onValueChange={setLeftTab}
              className="flex min-h-0 flex-1 flex-col"
            >
              <Tabs.List aria-label="Left panel" className="flex border-b border-border">
                <Tabs.Trigger value="layers" className={panelTab}>
                  Layers
                </Tabs.Trigger>
                <Tabs.Trigger value="assets" className={panelTab}>
                  Assets
                </Tabs.Trigger>
                <Tabs.Trigger value="ai" className={panelTab}>
                  AI
                </Tabs.Trigger>
                <Tabs.Trigger value="comments" className={panelTab}>
                  Comments
                </Tabs.Trigger>
                <Tabs.Trigger value="history" className={panelTab}>
                  History
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="layers" className="min-h-0 flex-1 overflow-y-auto p-3">
                {pages.data && (
                  <PageList
                    teamId={teamId}
                    projectId={projectId}
                    pages={pages.data}
                    currentPageId={
                      screenList.find((s) => s.filePath === selectedPath)?.pageId ?? null
                    }
                    hrefFor={(pageId) => `/file/${projectId}?page=${pageId}`}
                    canEdit={canWrite}
                    onNavigate={focusPage}
                  />
                )}
                <div className="mt-4 border-t border-border pt-3">
                  <LayersTree
                    screenName={screenList.find((s) => s.filePath === selectedPath)?.name ?? null}
                    nodes={selectedPath ? trees[selectedPath] : undefined}
                    selected={
                      selection && selection.path === selectedPath
                        ? { line: selection.line, column: selection.column }
                        : null
                    }
                    onSelect={(node) => {
                      if (!selectedPath) return;
                      setSelectRequest({
                        path: selectedPath,
                        line: node.line,
                        column: node.column,
                        nonce: Date.now(),
                      });
                    }}
                  />
                </div>
              </Tabs.Content>
              <Tabs.Content value="assets" className="min-h-0 flex-1 overflow-y-auto p-3">
                <AssetsPanel tokensCss={tokensCss} />
              </Tabs.Content>
              <Tabs.Content value="ai" className="min-h-0 flex-1">
                <ChatPanel projectId={projectId} canWrite={canWrite} />
              </Tabs.Content>
              <Tabs.Content value="comments" className="min-h-0 flex-1 overflow-y-auto p-3">
                <CommentsPanel
                  projectId={projectId}
                  threads={comments.data}
                  screens={screenList}
                  userId={session.user.id}
                  canWrite={canWrite}
                  canModerate={hasPermission(session, 'projects:delete')}
                  includeResolved={includeResolved}
                  onIncludeResolved={setIncludeResolved}
                  pendingPin={pendingPin}
                  onCancelPin={() => {
                    setPendingPin(null);
                  }}
                  activeId={activeComment}
                  onSelect={setActiveComment}
                />
              </Tabs.Content>
              <Tabs.Content value="history" className="min-h-0 flex-1 overflow-y-auto p-3">
                <HistoryPanel projectId={projectId} canWrite={canWrite} />
              </Tabs.Content>
            </Tabs.Root>
          </aside>
        )}

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
              tool={tool}
              pins={pins}
              selectRequest={selectRequest}
              onTree={(path, nodes) => {
                setTrees((current) => ({ ...current, [path]: nodes }));
              }}
              onPlacePin={(pageId, x, y) => {
                setPendingPin({ pageId, x, y });
                setPanels(true);
                setLeftTab('comments');
              }}
              onOpenPin={(id) => {
                setActiveComment(id);
                setPanels(true);
                setLeftTab('comments');
              }}
            />
          )}
          {screens.data && <CanvasToolbar tool={tool} canWrite={canWrite} actions={actions} />}
        </main>

        {panels && (
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
              onEdited={(change) => {
                history.record(change);
                void client.invalidateQueries({ queryKey: studioKeys.screens(projectId) });
              }}
            />
          </aside>
        )}
      </div>

      <Dialog.Root
        open={playing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPlaying(null);
            setPlayHistory([]);
          }
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
                <div
                  key={playTransition.n}
                  className={`shadow-xl ${playTransition.kind === 'dissolve' ? 'core-dissolve' : ''}`}
                  style={{ width: Math.min(DEVICES[device].width, 1440) }}
                >
                  <PreviewFrame
                    previewOrigin={previewOrigin}
                    path={playScreen.filePath}
                    code={playScreen.code}
                    tokensCss={tokensCss}
                    mode="play"
                    title={`Prototype: ${playScreen.name}`}
                    width={DEVICES[device].width}
                    height={DEVICES[device].height}
                    onNavigate={(route, transition) => {
                      let next: string | null = null;
                      if (route === 'back') {
                        next = playHistory.at(-1) ?? null;
                        setPlayHistory((h) => h.slice(0, -1));
                      } else if (screenList.some((s) => s.route === route)) {
                        next = route;
                        if (playing) setPlayHistory((h) => [...h, playing].slice(-50));
                      }
                      if (!next) return;
                      setPlaying(next);
                      setPlayTransition((t) => ({ kind: transition, n: t.n + 1 }));
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
            <Dialog.Title className="mb-4 text-lg font-semibold">File settings</Dialog.Title>
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
