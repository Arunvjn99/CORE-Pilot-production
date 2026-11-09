// Managed by CORE Studio. Changes are overwritten on template upgrades.
import { Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { RootLayout } from '../layouts/RootLayout';
import { routes } from './routes';

const router = createBrowserRouter([
  {
    element: (
      <Suspense fallback={null}>
        <RootLayout />
      </Suspense>
    ),
    children: routes.map(({ path, Component }) => ({ path, Component })),
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
