import { createBrowserRouter, Navigate } from 'react-router';
import { ProjectDashboard } from '../features/projects/project-dashboard';
import { MembersPage } from '../features/settings/members-page';
import { AiProvidersPage } from '../features/ai-providers/ai-providers-page';
import { AgentsPage } from '../features/settings/agents-page';
import { DesignSystemsPage } from '../features/settings/design-systems-page';
import { MetricsPage } from '../features/metrics/metrics-page';
import { SettingsLayout } from '../features/settings/settings-layout';
import { StudioRoute } from '../features/studio/studio-page';
import { AppShell } from './app-shell';
import { NotFoundPage } from './not-found-page';
import { RouteError } from './route-error';

export const router = createBrowserRouter([
  // The design studio is full-screen and has its own toolbar and panels.
  {
    path: 'projects/:projectId',
    element: <StudioRoute />,
    errorElement: <RouteError />,
  },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: <ProjectDashboard /> },
      { path: 'metrics', element: <MetricsPage /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="members" replace /> },
          { path: 'members', element: <MembersPage /> },
          { path: 'ai-providers', element: <AiProvidersPage /> },
          { path: 'agents', element: <AgentsPage /> },
          { path: 'design-systems', element: <DesignSystemsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
