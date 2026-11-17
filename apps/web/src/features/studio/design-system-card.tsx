import { Palette } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { FormDialog } from '../projects/project-dialogs';
import { useDesignMutations, useDesignSystems, useProjectDesign } from './studio-api';

const control =
  'w-full rounded border border-border bg-surface px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent';

/** The project's design system: pick a team system (copied into the repo) or edit the project's DESIGN.md. */
export function DesignSystemCard({
  projectId,
  teamId,
  canWrite,
}: {
  projectId: string;
  teamId: string;
  canWrite: boolean;
}) {
  const design = useProjectDesign(projectId);
  const systems = useDesignSystems(teamId);
  const { apply, update } = useDesignMutations(projectId);
  const [open, setOpen] = useState(false);
  const [designMd, setDesignMd] = useState('');
  const [tokensCss, setTokensCss] = useState('');
  const selectId = useId();
  const mdId = useId();
  const tokensId = useId();
  const error = apply.error ?? update.error;

  return (
    <section className="space-y-2 border-b border-border px-3 py-3">
      <h3 className="flex items-center gap-1 text-xs font-semibold tracking-wide text-text-muted uppercase">
        <Palette size={12} aria-hidden="true" /> Design system
      </h3>
      <label htmlFor={selectId} className="sr-only">
        Design system
      </label>
      <select
        id={selectId}
        className={control}
        disabled={!canWrite || apply.isPending || !design.data}
        value={design.data?.designSystemSlug ?? ''}
        onChange={(event) => {
          if (event.target.value) apply.mutate(event.target.value);
        }}
      >
        {(systems.data ?? []).map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
            {s.customized ? ' (customised)' : ''}
          </option>
        ))}
      </select>
      <p className="text-xs text-text-muted">
        Agents follow the project&apos;s DESIGN.md and tokens. Switching copies the team version
        into this project.
      </p>
      {canWrite && (
        <Button
          className="w-full justify-center"
          onClick={() => {
            if (design.data) {
              setDesignMd(design.data.designMd);
              setTokensCss(design.data.tokensCss);
            }
            setOpen(true);
          }}
          disabled={!design.data}
        >
          Edit project DESIGN.md
        </Button>
      )}
      {error && (
        <ErrorMessage>{error instanceof ApiError ? error.message : 'Could not save.'}</ErrorMessage>
      )}
      <FormDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) update.reset();
        }}
        title="Project design system"
        description="Changes apply to this project only and are saved in its repository."
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!design.data) return;
            update.mutate(
              { designMd, tokensCss, baseRevision: design.data.revision },
              {
                onSuccess: () => {
                  setOpen(false);
                },
              },
            );
          }}
        >
          <label htmlFor={mdId} className="text-sm font-medium">
            DESIGN.md
          </label>
          <textarea
            id={mdId}
            rows={12}
            className={`${control} font-mono`}
            value={designMd}
            onChange={(e) => {
              setDesignMd(e.target.value);
            }}
          />
          <label htmlFor={tokensId} className="text-sm font-medium">
            tokens.css
          </label>
          <textarea
            id={tokensId}
            rows={8}
            className={`${control} font-mono`}
            value={tokensCss}
            onChange={(e) => {
              setTokensCss(e.target.value);
            }}
          />
          {update.error && (
            <ErrorMessage>
              {update.error instanceof ApiError ? update.error.message : 'Could not save.'}
            </ErrorMessage>
          )}
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={update.isPending}>
              Save
            </Button>
          </div>
        </form>
      </FormDialog>
    </section>
  );
}
