import type { AgentDefinition, AgentKey } from '@core-studio/contracts';
import { Bot, History, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { hasPermission } from '../auth/permissions';
import { useSession } from '../auth/use-session';
import { useAgentMutations, useAgents, useAgentVersions } from '../studio/studio-api';

const control =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60';
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Settings → Agents: each agent's AGENT.md, model override and on/off, versioned with revert. */
export function AgentsPage() {
  const { data: session } = useSession();
  const teamId = session?.activeOrganizationId;
  const agents = useAgents(teamId ?? '');
  const [selected, setSelected] = useState<AgentKey>('orchestrator');
  if (!session || !teamId) return null;
  const canWrite = hasPermission(session, 'projects:write');
  const agent = agents.data?.find((a) => a.key === selected);

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Agents">
        <p className="mb-2 text-sm text-text-muted">
          The design team, in pipeline order. Every run records the versions it used.
        </p>
        {agents.isError && <ErrorMessage>Agents could not be loaded.</ErrorMessage>}
        <ul className="space-y-1">
          {(agents.data ?? []).map((a) => (
            <li key={a.key}>
              <button
                type="button"
                aria-current={a.key === selected ? 'true' : undefined}
                onClick={() => {
                  setSelected(a.key);
                }}
                className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent ${a.key === selected ? 'bg-surface-muted font-semibold' : 'hover:bg-surface-muted'}`}
              >
                <Bot size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>
                  <span className="block">{a.name}</span>
                  <span className="block text-xs font-normal text-text-muted">
                    {a.customized ? `Version ${String(a.version)}` : 'Default'}
                    {a.enabled ? '' : ' · off'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {agent && (
        <AgentEditor
          key={`${agent.key}-${String(agent.version)}`}
          teamId={teamId}
          agent={agent}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}

function AgentEditor({
  teamId,
  agent,
  canWrite,
}: {
  teamId: string;
  agent: AgentDefinition;
  canWrite: boolean;
}) {
  const { update, revert } = useAgentMutations(teamId);
  const versions = useAgentVersions(teamId, agent.key);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [model, setModel] = useState(agent.model ?? '');
  const [enabled, setEnabled] = useState(agent.enabled);
  const ids = { instructions: useId(), model: useId(), enabled: useId() };
  const required = agent.key === 'orchestrator' || agent.key === 'ui';
  const dirty =
    instructions !== agent.instructions ||
    model !== (agent.model ?? '') ||
    enabled !== agent.enabled;
  const error = update.error ?? revert.error;

  return (
    <section aria-labelledby="agent-heading" className="space-y-4">
      <div>
        <h2 id="agent-heading" className="text-lg font-semibold">
          {agent.name}{' '}
          <span className="font-mono text-sm font-normal text-text-muted">AGENT.md</span>
        </h2>
        <p className="text-sm text-text-muted">{agent.description}</p>
        {agent.updatedAt && (
          <p className="text-xs text-text-muted">
            Version {agent.version} · {dateTime.format(new Date(agent.updatedAt))}
            {agent.updatedByName ? ` · ${agent.updatedByName}` : ''}
          </p>
        )}
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({
            key: agent.key,
            instructions,
            model: model.trim() || null,
            enabled,
            expectedVersion: agent.version,
          });
        }}
      >
        <div className="space-y-1">
          <label htmlFor={ids.instructions} className="text-sm font-medium">
            Instructions
          </label>
          <textarea
            id={ids.instructions}
            rows={20}
            spellCheck={false}
            disabled={!canWrite}
            className={`${control} font-mono text-xs leading-relaxed`}
            value={instructions}
            onChange={(e) => {
              setInstructions(e.target.value);
            }}
          />
          <p className="text-xs text-text-muted">
            Markdown. The design system and the required output format are added automatically for
            every run.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={ids.model} className="text-sm font-medium">
              Model <span className="font-normal text-text-muted">(optional)</span>
            </label>
            <input
              id={ids.model}
              className={control}
              placeholder="Team default model"
              disabled={!canWrite}
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
              }}
            />
            <p className="text-xs text-text-muted">
              Uses the same API key. Leave empty to use the team default model.
            </p>
          </div>
          <label htmlFor={ids.enabled} className="flex items-start gap-2 pt-7 text-sm">
            <input
              id={ids.enabled}
              type="checkbox"
              checked={enabled}
              disabled={!canWrite || required}
              onChange={(e) => {
                setEnabled(e.target.checked);
              }}
            />
            <span>
              Enabled
              {required && (
                <span className="block text-xs text-text-muted">Required for every run.</span>
              )}
            </span>
          </label>
        </div>
        {error && (
          <ErrorMessage>
            {error instanceof ApiError ? error.message : 'Could not save.'}
          </ErrorMessage>
        )}
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={!dirty || update.isPending}>
              Save new version
            </Button>
            {agent.customized && (
              <Button
                disabled={revert.isPending}
                onClick={() => {
                  revert.mutate({ key: agent.key, toVersion: 0, expectedVersion: agent.version });
                }}
              >
                <RotateCcw size={14} aria-hidden="true" /> Reset to default
              </Button>
            )}
          </div>
        )}
      </form>
      {(versions.data?.length ?? 0) > 0 && (
        <section aria-labelledby="versions-heading" className="space-y-2">
          <h3 id="versions-heading" className="flex items-center gap-2 text-sm font-semibold">
            <History size={14} aria-hidden="true" /> Version history
          </h3>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {(versions.data ?? []).map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  Version {v.version}
                  <span className="block text-xs text-text-muted">
                    {dateTime.format(new Date(v.createdAt))}
                    {v.authorName ? ` · ${v.authorName}` : ''}
                    {v.model ? ` · ${v.model}` : ''}
                    {v.enabled ? '' : ' · off'}
                  </span>
                </span>
                {canWrite && v.version !== agent.version && (
                  <Button
                    disabled={revert.isPending}
                    onClick={() => {
                      revert.mutate({
                        key: agent.key,
                        toVersion: v.version,
                        expectedVersion: agent.version,
                      });
                    }}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
