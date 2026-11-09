import type { Permission, SessionResponse } from '@core-studio/contracts';
import { FolderKanban, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { hasPermission } from '../features/auth/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  permission: Permission;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/projects',
    label: 'Projects',
    icon: <FolderKanban size={18} />,
    permission: 'projects:read',
  },
  { to: '/settings', label: 'Settings', icon: <Settings size={18} />, permission: 'members:read' },
];

export function visibleNavItems(session: SessionResponse): NavItem[] {
  return NAV_ITEMS.filter((item) => hasPermission(session, item.permission));
}

export function MainNavigation({ session }: { session: SessionResponse }) {
  return (
    <nav aria-label="Main">
      <ul className="flex gap-1 md:flex-col">
        {visibleNavItems(session).map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-surface-muted font-semibold' : 'text-text-muted hover:bg-surface-muted hover:text-text'}`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
