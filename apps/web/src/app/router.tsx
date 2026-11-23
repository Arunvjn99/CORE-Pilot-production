import { createBrowserRouter, Navigate } from 'react-router';
import { FilesLayout } from '../features/files/files-layout';
import { FilesView } from '../features/files/files-view';
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
      { index: true, element: <Navigate to="/files/recent" replace /> },
      // Figma-style file browser (ADR-0014). The old dashboard URL now opens Recents.
      { path: 'projects', element: <Navigate to="/files/recent" replace /> },
      {
        path: 'files',
        element: <FilesLayout />,
        children: [
          { index: true, element: <Navigate to="recent" replace /> },
          { path: 'recent', element: <FilesView key="recent" mode="recent" /> },
          { path: 'drafts', element: <FilesView key="drafts" mode="drafts" /> },
          { path: 'project/:folderId', element: <FilesView key="project" mode="project" /> },
          { path: 'trash', element: <FilesView key="trash" mode="trash" /> },
        ],
      },
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
