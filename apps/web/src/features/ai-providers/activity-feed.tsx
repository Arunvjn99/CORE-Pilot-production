import type { LlmActivity } from '@core-studio/contracts';
import { History } from 'lucide-react';
import { ErrorMessage } from '../../components/ui';
import { formatTime } from './credential-list';
import { ACTIVITY_LABELS, probeStatus, providerInfo } from './providers';

function describe(event: LlmActivity): string {
  const parts: string[] = [];
  if (event.label) parts.push(event.label);
  if (event.provider) parts.push(providerInfo(event.provider).name);
  if (event.scope === 'user') parts.push('personal');
  if (event.scope === 'platform') parts.push('company-managed');
  return parts.join(' · ');
}

export function ActivityFeed({
  events,
  isError,
}: {
  events: LlmActivity[] | undefined;
  isError: boolean;
}) {
  return (
    <section
      aria-labelledby="activity-heading"
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex items-center gap-2">
        <History size={18} aria-hidden="true" className="text-text-muted" />
        <h2 id="activity-heading" className="font-semibold">
          Recent activity
        </h2>
      </div>
      {isError && <ErrorMessage>Activity could not be loaded.</ErrorMessage>}
      {events?.length === 0 && <p className="text-sm text-text-muted">No activity yet.</p>}
      {events && events.length > 0 && (
        <ol
          // Scrollable region: keyboard users must be able to focus it to scroll (WCAG 2.1.1).
          tabIndex={0}
          aria-labelledby="activity-heading"
          className="max-h-96 space-y-3 overflow-y-auto rounded pr-1 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {events.map((event) => (
            <li key={event.id} className="border-l-2 border-border pl-3 text-sm">
              <p>
                <span className="font-medium">{event.actorName ?? 'Someone'}</span>{' '}
                {ACTIVITY_LABELS[event.action] ?? event.action}
                {event.outcome && (
                  <span className="text-text-muted"> — {probeStatus(event.outcome).label}</span>
                )}
              </p>
              {describe(event) && <p className="text-text-muted">{describe(event)}</p>}
              <p className="text-xs text-text-muted">
                <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-text-muted">
        Events about personal credentials are only shown to the person who made them.
      </p>
    </section>
  );
}
