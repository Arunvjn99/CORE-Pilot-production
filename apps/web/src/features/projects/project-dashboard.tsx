import { FolderKanban } from 'lucide-react';
import { EmptyState, PageHeader } from '../../components/ui';
import { SystemStatus } from '../system/system-status';

export function ProjectDashboard() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        description="React applications your team designs and edits in the canvas."
      />
      <EmptyState icon={<FolderKanban size={32} />} title="No projects yet">
        Project creation is being built next. Once available, each project is a real React app with
        version checkpoints.
      </EmptyState>
      <SystemStatus />
    </div>
  );
}
