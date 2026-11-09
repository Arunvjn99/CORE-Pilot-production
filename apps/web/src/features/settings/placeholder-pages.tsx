import { Palette } from 'lucide-react';
import { EmptyState } from '../../components/ui';

export function DesignSystemsPage() {
  return (
    <EmptyState icon={<Palette size={32} />} title="No design systems registered">
      The CORE design system will be registered once its React component package is available to the
      platform. Only verified packages and versions appear here.
    </EmptyState>
  );
}
