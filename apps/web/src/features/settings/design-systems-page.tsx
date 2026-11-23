import type { DesignSystem } from '@core-studio/contracts';
import { Palette, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { hasPermission } from '../auth/permissions';
import { useSession } from '../auth/use-session';
import { colorTokens, SAFE_COLOR, tokenValues } from '../studio/class-utils';
import { useDesignSystem, useDesignSystemMutations, useDesignSystems } from '../studio/studio-api';

const control =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60';

/** Reads `--name: value;` pairs to preview colour tokens (display only, never injected as CSS). */
/** Settings → Design systems: CORE 2.0 and others; each is a versioned DESIGN.md + tokens.css. */
export function DesignSystemsPage() {
  const { data: session } = useSession();
  const teamId = session?.activeOrganizationId ?? '';
  const systems = useDesignSystems(teamId);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const current = selected ?? systems.data?.[0]?.slug ?? null;
  const system = useDesignSystem(teamId, creating ? null : current);
  if (!session || !teamId) return null;
  const canWrite = hasPermission(session, 'projects:write');

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Design systems" className="space-y-2">
        {systems.isError && <ErrorMessage>Design systems could not be loaded.</ErrorMessage>}
        <ul className="space-y-1">
          {(systems.data ?? []).map((s) => (
            <li key={s.slug}>
              <button
                type="button"
                aria-current={!creating && s.slug === current ? 'true' : undefined}
                onClick={() => {
                  setCreating(false);
                  setSelected(s.slug);
                }}
                className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent ${!creating && s.slug === current ? 'bg-surface-muted font-semibold' : 'hover:bg-surface-muted'}`}
              >
                <Palette size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>
                  <span className="block">{s.name}</span>
                  <span className="block text-xs font-normal text-text-muted">
                    {s.custom
                      ? 'Custom'
                      : s.customized
                        ? `Customised · v${String(s.version)}`
                        : 'Default'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {canWrite && (
          <Button
            className="w-full justify-center"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus size={14} aria-hidden="true" /> New design system
          </Button>
        )}
      </nav>
      {creating ? (
        <SystemEditor
          teamId={teamId}
          system={null}
          canWrite={canWrite}
          onCreated={(slug) => {
            setCreating(false);
            setSelected(slug);
          }}
        />
      ) : (
        system.data && (
          <SystemEditor
            key={`${system.data.slug}-${String(system.data.version)}`}
            teamId={teamId}
            system={system.data}
            canWrite={canWrite}
          />
        )
      )}
    </div>
  );
}

function SystemEditor({
  teamId,
  system,
  canWrite,
  onCreated,
}: {
  teamId: string;
  system: DesignSystem | null;
  canWrite: boolean;
  onCreated?: (slug: string) => void;
}) {
  const { update, create } = useDesignSystemMutations(teamId);
  const [name, setName] = useState(system?.name ?? '');
  const [slug, setSlug] = useState('');
  const [designMd, setDesignMd] = useState(
    system?.designMd ?? '# Design system\n\n## Colour\n\n## Typography\n',
  );
  const [tokensCss, setTokensCss] = useState(system?.tokensCss ?? '');
  const ids = { name: useId(), slug: useId(), md: useId(), tokens: useId() };
  const values = tokenValues(tokensCss);
  const swatches = colorTokens(tokensCss).filter((t) => SAFE_COLOR.test(values[t] ?? ''));
  const mutation = system ? update : create;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (system)
          update.mutate({
            slug: system.slug,
            name,
            designMd,
            tokensCss,
            expectedVersion: system.version,
          });
        else
          create.mutate(
            { slug, name, designMd, tokensCss },
            { onSuccess: (s) => onCreated?.(s.slug) },
          );
      }}
    >
      <h2 className="text-lg font-semibold">{system ? system.name : 'New design system'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={ids.name} className="text-sm font-medium">
            Name
          </label>
          <input
            id={ids.name}
            required
            maxLength={80}
            disabled={!canWrite}
            className={control}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        {!system && (
          <div className="space-y-1">
            <label htmlFor={ids.slug} className="text-sm font-medium">
              Id
            </label>
            <input
              id={ids.slug}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={40}
              className={`${control} font-mono`}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
              }}
            />
          </div>
        )}
      </div>
      {swatches.length > 0 && (
        <ul aria-label="Colour tokens" className="flex flex-wrap gap-2">
          {swatches.map((t) => (
            <li
              key={t}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
            >
              <span
                aria-hidden="true"
                className="size-4 rounded border border-border"
                style={{ background: values[t] }}
              />
              {t.replace('--color-', '')}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1">
        <label htmlFor={ids.md} className="text-sm font-medium">
          DESIGN.md
        </label>
        <textarea
          id={ids.md}
          rows={18}
          spellCheck={false}
          disabled={!canWrite}
          className={`${control} font-mono text-xs`}
          value={designMd}
          onChange={(e) => {
            setDesignMd(e.target.value);
          }}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.tokens} className="text-sm font-medium">
          tokens.css
        </label>
        <textarea
          id={ids.tokens}
          rows={12}
          spellCheck={false}
          disabled={!canWrite}
          className={`${control} font-mono text-xs`}
          value={tokensCss}
          onChange={(e) => {
            setTokensCss(e.target.value);
          }}
        />
        <p className="text-xs text-text-muted">
          Every design system must define the shared variable names (colours, font, radius, shadow,
          focus ring).
        </p>
      </div>
      {mutation.error && (
        <ErrorMessage>
          {mutation.error instanceof ApiError ? mutation.error.message : 'Could not save.'}
        </ErrorMessage>
      )}
      {canWrite && (
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {system ? 'Save new version' : 'Create design system'}
        </Button>
      )}
    </form>
  );
}
