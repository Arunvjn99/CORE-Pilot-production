import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/files" className="underline">
        Back to files
      </Link>
    </div>
  );
}
