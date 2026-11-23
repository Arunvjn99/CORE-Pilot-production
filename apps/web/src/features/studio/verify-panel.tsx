import {
  type Screen,
  VERIFY_SEVERITIES,
  type VerifyIssue,
  type VerifySeverity,
} from '@core-studio/contracts';
import { CheckCircle2, ListChecks, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui';
import type { ScreenCheck } from './verify-checks';

const SEVERITY_LABEL: Record<VerifySeverity, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};
const SEVERITY_DOT: Record<VerifySeverity, string> = {
  critical: 'bg-danger',
  serious: 'bg-warning',
  moderate: 'bg-accent',
  minor: 'bg-text-muted',
};

export function countBySeverity(issues: VerifyIssue[]): Record<VerifySeverity, number> {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

function IssueItem({
  issue,
  onShow,
}: {
  issue: VerifyIssue;
  onShow: ((line: number, column: number) => void) | undefined;
}) {
  const body = (
    <>
      <span className="block text-text">{issue.message}</span>
      <span className="mt-0.5 block text-text-muted">{issue.help}</span>
      <span className="mt-0.5 block font-mono text-text-muted">
        {issue.id}
        {issue.category === 'design-system' ? ' · design system' : ' · accessibility'}
        {issue.line !== undefined && ` · line ${String(issue.line)}`}
      </span>
    </>
  );
  const { line, column } = issue;
  if (line === undefined || column === undefined || !onShow)
    return <div className="rounded px-2 py-1.5 text-xs">{body}</div>;
  return (
    <button
      type="button"
      className="block min-h-6 w-full rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => {
        onShow(line, column);
      }}
    >
      {body}
    </button>
  );
}

function ScreenResults({
  screen,
  check,
  onShowIssue,
}: {
  screen: Screen;
  check: ScreenCheck;
  onShowIssue: ((path: string, line: number, column: number) => void) | undefined;
}) {
  const headingId = `verify-${screen.pageId}`;
  if (check.status === 'running')
    return (
      <section aria-labelledby={headingId} className="space-y-1">
        <h4 id={headingId} className="text-xs font-semibold">
          {screen.name}
        </h4>
        <p role="status" className="text-xs text-text-muted">
          Checking…
        </p>
      </section>
    );
  const { issues, checkedAt, error } = check.result;
  const counts = countBySeverity(issues);
  const time = new Date(checkedAt).toLocaleTimeString();
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h4 id={headingId} className="text-xs font-semibold">
        {screen.name}
      </h4>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : issues.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 size={14} aria-hidden="true" /> No issues found · checked {time}
        </p>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            {plural(issues.length, 'issue')}:{' '}
            {VERIFY_SEVERITIES.filter((s) => counts[s] > 0)
              .map((s) => `${String(counts[s])} ${s}`)
              .join(', ')}{' '}
            · checked {time}
          </p>
          {VERIFY_SEVERITIES.filter((s) => counts[s] > 0).map((severity) => (
            <div key={severity} className="space-y-0.5">
              <h5 className="flex items-center gap-1.5 text-xs font-medium">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-2 rounded-full ${SEVERITY_DOT[severity]}`}
                />
                {SEVERITY_LABEL[severity]} ({counts[severity]})
              </h5>
              <ul className="space-y-0.5">
                {issues
                  .filter((i) => i.severity === severity)
                  .map((issue, index) => (
                    <li key={`${issue.id}-${String(issue.line)}-${String(index)}`}>
                      <IssueItem
                        issue={issue}
                        onShow={
                          onShowIssue &&
                          ((line, column) => {
                            onShowIssue(screen.filePath, line, column);
                          })
                        }
                      />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/**
 * Automated checks of the rendered screens: accessibility (axe-core, WCAG 2.2 AA) and the design
 * system. Results are per screen; clicking an issue selects its element on the canvas.
 */
export function VerifyChecks({
  screens,
  selectedPath,
  checks,
  onRun,
  onShowIssue,
}: {
  screens: Screen[];
  selectedPath: string | null;
  checks: Record<string, ScreenCheck>;
  onRun: (paths: string[]) => void;
  onShowIssue?: ((path: string, line: number, column: number) => void) | undefined;
}) {
  const selected = screens.find((s) => s.filePath === selectedPath) ?? null;
  const running = (path: string) => checks[path]?.status === 'running';
  const checked = [
    ...(selected ? [selected] : []),
    ...screens.filter((s) => s !== selected),
  ].filter((s) => checks[s.filePath]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!selected || running(selected.filePath)}
          onClick={() => {
            if (selected) onRun([selected.filePath]);
          }}
        >
          <ShieldCheck size={14} aria-hidden="true" /> Run checks
        </Button>
        <Button
          disabled={screens.length === 0 || screens.every((s) => running(s.filePath))}
          onClick={() => {
            onRun(screens.map((s) => s.filePath));
          }}
        >
          <ListChecks size={14} aria-hidden="true" /> Check all screens
        </Button>
      </div>
      {checked.length === 0 ? (
        <p className="text-xs text-text-muted">
          {selected
            ? `Check ${selected.name} for accessibility (WCAG 2.2 AA) and design-system problems.`
            : 'Select a screen to check it for accessibility (WCAG 2.2 AA) and design-system problems.'}
        </p>
      ) : (
        <div className="space-y-4">
          {checked.map((screen) => {
            const check = checks[screen.filePath];
            return check ? (
              <ScreenResults
                key={screen.pageId}
                screen={screen}
                check={check}
                onShowIssue={onShowIssue}
              />
            ) : null;
          })}
        </div>
      )}
      <p className="text-xs text-text-muted">
        Automated checks find some problems, not all. Results clear when a screen changes.
      </p>
    </div>
  );
}
