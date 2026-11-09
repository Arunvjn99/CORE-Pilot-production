import { useApiHealth } from './use-api-health';

export function SystemStatus() {
  const health = useApiHealth();

  let label = 'Checking platform status…';
  let tone = 'text-text-muted';
  if (health.isSuccess) {
    label = `Platform API online (version ${health.data.version})`;
    tone = 'text-success';
  } else if (health.isError) {
    label = 'Platform API unavailable';
    tone = 'text-danger';
  }

  return (
    <section
      aria-labelledby="system-status-heading"
      className="rounded-lg border border-border bg-surface-muted p-4"
    >
      <h2 id="system-status-heading" className="text-sm font-semibold">
        System status
      </h2>
      <p role="status" aria-live="polite" className={`mt-1 text-sm ${tone}`}>
        {label}
      </p>
    </section>
  );
}
