import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="underline">
        Back to workspace
      </Link>
    </div>
  );
}
