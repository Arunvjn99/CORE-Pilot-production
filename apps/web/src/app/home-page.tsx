import { SystemStatus } from '../features/system/system-status';

export function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Workspace</h1>
      <p className="text-text-muted">Projects arrive in the next slices.</p>
      <SystemStatus />
    </div>
  );
}
