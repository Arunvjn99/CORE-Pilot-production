import { Link } from 'react-router';

/** Never renders error details (they may contain internal information); the API logs carry the correlation id. */
export function RouteError() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6">
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-text-muted">
          Please reload the page. If this keeps happening, contact support.
        </p>
        <Link to="/projects" className="underline">
          Back to projects
        </Link>
      </div>
    </main>
  );
}
