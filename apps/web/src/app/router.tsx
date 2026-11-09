import { createBrowserRouter, Navigate } from 'react-router';
import { ProjectDashboard } from '../features/projects/project-dashboard';
import { MembersPage } from '../features/settings/members-page';
import { AiProvidersPage } from '../features/ai-providers/ai-providers-page';
import { DesignSystemsPage } from '../features/settings/placeholder-pages';
import { SettingsLayout } from '../features/settings/settings-layout';
import { WorkspaceRoute } from '../features/projects/workspace/workspace-layout';
import { AppShell } from './app-shell';
import { NotFoundPage } from './not-found-page';
import { RouteError } from './route-error';

export const router = createBrowserRouter([
  // The project workspace is full-screen and has its own toolbar and navigation.
  {
    path: 'projects/:projectId/:section?',
    element: <WorkspaceRoute />,
    errorElement: <RouteError />,
  },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: <ProjectDashboard /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="members" replace /> },
          { path: 'members', element: <MembersPage /> },
          { path: 'ai-providers', element: <AiProvidersPage /> },
          { path: 'design-systems', element: <DesignSystemsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
