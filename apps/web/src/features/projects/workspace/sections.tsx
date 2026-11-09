import type { Project, ProjectPage } from '@core-studio/contracts';
import { Bot, Code2, LayoutTemplate, MousePointerClick, Palette, Settings } from 'lucide-react';
import { AlertDialog } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, ErrorMessage } from '../../../components/ui';
import { errorMessage, ProjectForm } from '../project-dialogs';
import { useProjectMutations } from '../projects-api';

export type SectionId = 'canvas' | 'code' | 'assistant' | 'design-system' | 'settings';

export const SECTIONS: { id: SectionId; label: string; icon: typeof Code2 }[] = [
  { id: 'canvas', label: 'Visual canvas', icon: LayoutTemplate },
  { id: 'code', label: 'Code editor', icon: Code2 },
  { id: 'assistant', label: 'AI assistant', icon: Bot },
  { id: 'design-system', label: 'Design system', icon: Palette },
  { id: 'settings', label: 'Project settings', icon: Settings },
];

export const isSection = (value: string | undefined): value is SectionId =>
  SECTIONS.some((s) => s.id === value);

function NotYetAvailable({
  icon,
  title,
  arrives,
  children,
}: {
  icon: ReactNode;
  title: string;
  arrives: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-12 text-center">
      <span aria-hidden="true" className="rounded-xl bg-surface-muted p-3 text-text-muted">
        {icon}
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="rounded-full border border-border px-2.5 py-0.5 text-xs text-text-muted">
        Not available yet · {arrives}
      </p>
      <div className="space-y-2 text-sm text-text-muted">{children}</div>
    </div>
  );
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function CanvasSection({ page }: { page: ProjectPage | undefined }) {
  return (
    <div className="flex h-full flex-col gap-4">
      {page && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{page.name}</h2>
          <p className="text-xs text-text-muted">
            <code className="font-mono">{page.route}</code> · updated{' '}
            {dateTime.format(new Date(page.updatedAt))}
          </p>
        </div>
      )}
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-canvas p-6">
        <NotYetAvailable
          icon={<MousePointerClick size={28} />}
          title="The visual canvas is not built yet"
          arrives="slices 2.6–2.7"
        >
          <p>
            This page is saved with its name and route. In upcoming slices it will render as a live
            React page that you can select and edit visually, with changes written to source code.
          </p>
        </NotYetAvailable>
      </div>
    </div>
  );
}

export function CodeSection() {
  return (
    <NotYetAvailable
      icon={<Code2 size={28} />}
      title="Code editor"
      arrives="after the project repository slice"
    >
      <p>
        Projects don’t have source files yet. Once each project gets its repository, every page
        becomes a route file you can view and edit here alongside the canvas.
      </p>
    </NotYetAvailable>
  );
}

export function AssistantSection() {
  return (
    <NotYetAvailable
      icon={<Bot size={28} />}
      title="AI assistant"
      arrives="with the canvas edit loop"
    >
      <p>
        The assistant will plan and apply edits to this project through the AI runtime using your
        team’s configured provider and default model. It isn’t connected to projects yet.
      </p>
    </NotYetAvailable>
  );
}

export function DesignSystemSection() {
  return (
    <NotYetAvailable icon={<Palette size={28} />} title="Design system" arrives="Phase 5">
      <p>
        CORE components and tokens will be available here once the CORE React package is registered
        with the platform. Only verified packages and versions will be listed.
      </p>
    </NotYetAvailable>
  );
}

export function SettingsSection({
  project,
  teamId,
  canEdit,
}: {
  project: Project;
  teamId: string;
  canEdit: boolean;
}) {
  const { update } = useProjectMutations(teamId);
  const [saved, setSaved] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const navigate = useNavigate();
  const archived = project.status === 'archived';

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section aria-labelledby="general-heading" className="space-y-4">
        <h2 id="general-heading" className="text-lg font-semibold">
          General
        </h2>
        {canEdit && !archived ? (
          <div className="rounded-xl border border-border p-4">
            <ProjectForm
              key={project.updatedAt}
              inDialog={false}
              initial={project}
              submitLabel="Save changes"
              pending={update.isPending}
              error={update.error}
              onSubmit={(values) => {
                setSaved(false);
                update.mutate(
                  { id: project.id, ...values, expectedUpdatedAt: project.updatedAt },
                  {
                    onSuccess: () => {
                      setSaved(true);
                    },
                  },
                );
              }}
            />
            {saved && (
              <p role="status" className="mt-3 text-sm text-success">
                Saved.
              </p>
            )}
          </div>
        ) : (
          <dl className="grid grid-cols-[8rem_1fr] gap-2 rounded-xl border border-border p-4 text-sm">
            <dt className="text-text-muted">Name</dt>
            <dd>{project.name}</dd>
            <dt className="text-text-muted">Description</dt>
            <dd>{project.description || '—'}</dd>
          </dl>
        )}
      </section>
      {canEdit && (
        <section
          aria-labelledby="archive-heading"
          className="space-y-3 rounded-xl border border-danger/40 p-4"
        >
          <h2 id="archive-heading" className="font-semibold">
            {archived ? 'Restore project' : 'Archive project'}
          </h2>
          <p className="text-sm text-text-muted">
            {archived
              ? 'Restoring makes the project editable again and lists it with your active projects.'
              : 'Archived projects are read-only and move to the Archived list. Nothing is deleted; you can restore it at any time.'}
          </p>
          {update.error && !confirmArchive ? (
            <ErrorMessage>
              {errorMessage(update.error, 'The change could not be saved.')}
            </ErrorMessage>
          ) : null}
          {archived ? (
            <Button
              onClick={() => {
                update.mutate({
                  id: project.id,
                  status: 'active',
                  expectedUpdatedAt: project.updatedAt,
                });
              }}
            >
              Restore project
            </Button>
          ) : (
            <AlertDialog.Root open={confirmArchive} onOpenChange={setConfirmArchive}>
              <AlertDialog.Trigger asChild>
                <Button variant="danger">Archive project</Button>
              </AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
                <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-1/2 space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
                  <AlertDialog.Title className="text-lg font-semibold">
                    Archive {project.name}?
                  </AlertDialog.Title>
                  <AlertDialog.Description className="text-sm text-text-muted">
                    The project becomes read-only and moves to Archived. You can restore it later.
                  </AlertDialog.Description>
                  <div className="flex justify-end gap-2">
                    <AlertDialog.Cancel asChild>
                      <Button>Cancel</Button>
                    </AlertDialog.Cancel>
                    <Button
                      variant="danger"
                      disabled={update.isPending}
                      onClick={() => {
                        update.mutate(
                          {
                            id: project.id,
                            status: 'archived',
                            expectedUpdatedAt: project.updatedAt,
                          },
                          {
                            onSuccess: () => {
                              setConfirmArchive(false);
                              void navigate('/projects');
                            },
                          },
                        );
                      }}
                    >
                      Archive
                    </Button>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          )}
        </section>
      )}
    </div>
  );
}
