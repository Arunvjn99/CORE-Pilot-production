import { signInUrl } from './use-session';

const AUTH_ERRORS: Record<string, string> = {
  expired: 'Your sign-in attempt expired or was started in another browser. Please try again.',
  failed: 'Sign-in failed. Your account may not be permitted to use CORE AI Design Studio.',
};

export function SignInPage() {
  const params = new URLSearchParams(window.location.search);
  const error = AUTH_ERRORS[params.get('authError') ?? ''];
  const returnTo = window.location.pathname === '/' ? '/' : window.location.pathname;

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-surface-muted p-8">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">CORE AI Design Studio</h1>
          <p className="text-sm text-text-muted">Sign in with your company account to continue.</p>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
          >
            {error}
          </p>
        )}
        <a
          href={signInUrl(returnTo)}
          className="block rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-accent-contrast hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Sign in with Microsoft
        </a>
      </div>
    </main>
  );
}
