import type { Metrics } from '@core-studio/contracts';
import { Activity, AlertTriangle, Clock, Coins, Layers, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ErrorMessage, PageHeader } from '../../components/ui';
import { useSession } from '../auth/use-session';
import { useMetrics } from '../studio/studio-api';

const AGENT_NAMES: Record<string, string> = {
  orchestrator: 'Orchestrator',
  ux: 'UX designer',
  ui: 'UI designer',
  reviewer: 'Reviewer',
};
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);

function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <span aria-hidden="true">{icon}</span>
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="text-xs text-text-muted">{detail}</p>}
    </div>
  );
}

/** Horizontal bars with the exact value as text (accessible without colour or hover). */
function Bars({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[8rem_1fr_5rem] items-center gap-3 text-sm">
          <span className="truncate">{r.label}</span>
          <span className="h-2 rounded-full bg-surface-muted">
            <span
              className="block h-2 rounded-full bg-accent"
              style={{ width: `${String((r.value / max) * 100)}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-text-muted">
            {compact.format(r.value)} {unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Dashboard({ data }: { data: Metrics }) {
  const t = data.totals;
  const tokens = t.inputTokens + t.outputTokens;
  const empty = <p className="text-sm text-text-muted">No data in this period.</p>;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          icon={<Activity size={16} />}
          label="Design runs"
          value={String(t.runs)}
          detail={`${String(t.succeeded)} succeeded · ${String(t.failed)} failed`}
        />
        <Stat icon={<Layers size={16} />} label="Screens generated" value={String(t.screens)} />
        <Stat
          icon={<Coins size={16} />}
          label="Tokens"
          value={compact.format(tokens)}
          detail={`${compact.format(t.inputTokens)} in · ${compact.format(t.outputTokens)} out`}
        />
        <Stat
          icon={<Star size={16} />}
          label="Avg review score"
          value={t.avgReviewScore === null ? '—' : String(t.avgReviewScore)}
        />
        <Stat icon={<Clock size={16} />} label="Avg run time" value={seconds(t.avgDurationMs)} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Tokens by agent">
          {data.byAgent.length ? (
            <Bars
              rows={data.byAgent.map((a) => ({
                label: AGENT_NAMES[a.agent] ?? a.agent,
                value: a.inputTokens + a.outputTokens,
              }))}
              unit="tokens"
            />
          ) : (
            empty
          )}
        </Panel>
        <Panel title="Agent performance">
          {data.byAgent.length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col" className="py-1 font-medium">
                    Agent
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Calls
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Failures
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Avg time
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.byAgent.map((a) => (
                  <tr key={a.agent} className="border-t border-border">
                    <td className="py-1">{AGENT_NAMES[a.agent] ?? a.agent}</td>
                    <td className="py-1 text-right tabular-nums">{a.calls}</td>
                    <td className="py-1 text-right tabular-nums">{a.failures}</td>
                    <td className="py-1 text-right tabular-nums">{seconds(a.avgDurationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            empty
          )}
        </Panel>
        <Panel title="Runs per day">
          {data.byDay.length ? (
            <Bars rows={data.byDay.map((d) => ({ label: d.day, value: d.runs }))} unit="runs" />
          ) : (
            empty
          )}
        </Panel>
        <Panel title="Tokens by model">
          {data.byModel.length ? (
            <Bars
              rows={data.byModel.map((m) => ({ label: m.model, value: m.tokens }))}
              unit="tokens"
            />
          ) : (
            empty
          )}
        </Panel>
        <Panel title="Projects">
          {data.byProject.length ? (
            <Bars
              rows={data.byProject.map((p) => ({ label: p.name, value: p.tokens }))}
              unit="tokens"
            />
          ) : (
            empty
          )}
        </Panel>
        <Panel title="Failures by cause">
          {data.errors.length ? (
            <ul className="space-y-1 text-sm">
              {data.errors.map((e) => (
                <li key={e.code} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <AlertTriangle size={14} aria-hidden="true" className="text-warning" />
                    <code>{e.code}</code>
                  </span>
                  <span className="tabular-nums">{e.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">No failures in this period.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Usage, quality and speed of the agent team, from recorded runs (independent of LangSmith). */
export function MetricsPage() {
  const { data: session } = useSession();
  const [days, setDays] = useState(30);
  const metrics = useMetrics(session?.activeOrganizationId ?? '', days);
  return (
    <div>
      <PageHeader
        title="Metrics"
        description="Token usage, quality and speed of the agent team for this team's projects."
        actions={
          <label className="flex items-center gap-2 text-sm">
            Period
            <select
              className="rounded-md border border-border bg-surface px-2 py-1"
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
              }}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
        }
      />
      {metrics.isError && <ErrorMessage>Metrics could not be loaded.</ErrorMessage>}
      {metrics.isPending && <p role="status">Loading metrics…</p>}
      {metrics.data && <Dashboard data={metrics.data} />}
    </div>
  );
}
