import type { Project } from '@core-studio/contracts';
import { AlertDialog } from 'radix-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, ErrorMessage } from '../../../components/ui';
import { errorMessage, ProjectForm } from '../project-dialogs';
import { useProjectMutations } from '../projects-api';

/** Project settings (rename, description, archive), shown from the studio toolbar. */
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
                              void navigate('/files');
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
