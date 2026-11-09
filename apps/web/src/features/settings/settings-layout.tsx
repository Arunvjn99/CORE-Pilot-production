import type { Permission } from '@core-studio/contracts';
import { NavLink, Outlet } from 'react-router';
import { PageHeader } from '../../components/ui';
import { useSession } from '../auth/use-session';
import { hasPermission } from '../auth/permissions';

const TABS: { to: string; label: string; permission: Permission }[] = [
  { to: 'members', label: 'Members', permission: 'members:read' },
  { to: 'ai-providers', label: 'AI providers', permission: 'providers:read' },
  { to: 'design-systems', label: 'Design systems', permission: 'projects:read' },
];

export function SettingsLayout() {
  const { data: session } = useSession();
  const tabs = TABS.filter((tab) => hasPermission(session, tab.permission));
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage your team, AI providers and design systems."
      />
      <nav aria-label="Settings" className="mb-6 border-b border-border">
        <ul className="flex gap-1">
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  `-mb-px block border-b-2 px-3 py-2 text-sm ${isActive ? 'border-accent font-semibold' : 'border-transparent text-text-muted hover:text-text'}`
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
