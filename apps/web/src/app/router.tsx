import { createBrowserRouter } from 'react-router';
import { AppShell } from './app-shell';
import { HomePage } from './home-page';
import { NotFoundPage } from './not-found-page';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
