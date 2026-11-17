import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Ollama-compatible stand-in for E2E design runs (the only stand-in in the journey: browser, nginx,
 * API, AI runtime, LangGraph, Redis, Postgres and the preview origin are all real). It answers by
 * the agent's output contract and returns two small, token-styled screens that link to each other.
 * Listens on all interfaces so the ai-runtime container reaches it as host.docker.internal.
 */
export const MODEL = 'studio-e2e:latest';

const SIGN_IN = `import { useState } from 'react';

export default function SignIn() {
  const [email, setEmail] = useState('');
  return (
    <main className="min-h-screen bg-[var(--color-surface-2)] flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-1)]">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">Welcome back</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Sign in to manage your retirement plan.</p>
        <label className="mt-6 block text-sm font-medium text-[var(--color-text)]" htmlFor="email">Work email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2" />
        <button type="button" data-link="/dashboard" className="mt-6 w-full rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 font-medium text-[var(--color-on-primary)]">Continue</button>
      </section>
    </main>
  );
}
`;

const DASHBOARD = `export default function Dashboard() {
  const cards = [
    { label: 'Balance', value: '$248,310' },
    { label: 'Contribution', value: '8% of salary' },
    { label: 'Employer match', value: '4%' },
  ];
  return (
    <main className="min-h-screen bg-[var(--color-surface-2)] p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">Your plan</h1>
        <button type="button" data-link="/" className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text)]">Sign out</button>
      </header>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <section key={card.label} className="rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-1)]">
            <p className="text-sm text-[var(--color-text-muted)]">{card.label}</p>
            <p className="mt-1 text-xl font-semibold text-[var(--color-text)]">{card.value}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
`;

const SCREENS = [
  { name: 'Sign in', route: '/', code: SIGN_IN },
  { name: 'Dashboard', route: '/dashboard', code: DASHBOARD },
];

function answer(system: string, user: string): string {
  if (system.includes('"title": string, "summary": string'))
    return JSON.stringify({
      title: 'Retirement sign-in',
      summary: 'A sign-in screen and the plan dashboard',
      screens: SCREENS.map((s, i) => ({
        name: s.name,
        route: s.route,
        purpose: `${s.name} for plan participants`,
        links: [SCREENS[(i + 1) % SCREENS.length]?.route ?? '/'],
      })),
      todos: ['Plan the screens', 'Lay out each screen', 'Build in CORE 2.0', 'Review'],
    });
  if (system.includes('"layout": string'))
    return JSON.stringify({
      screens: SCREENS.map((s) => ({
        route: s.route,
        layout: 'centered card',
        sections: [{ name: 'Main', content: s.name }],
        primaryAction: 'Continue',
        navigation: [],
      })),
    });
  if (system.includes('"score": 0-100'))
    return JSON.stringify({
      screens: SCREENS.map((s) => ({
        route: s.route,
        score: 90,
        pass: true,
        checks: [{ id: 'tokens', pass: true, note: 'Uses design tokens only' }],
        fixes: [],
      })),
    });
  const route = /Screen: .+ \((\/[^)]*)\)/.exec(user)?.[1] ?? '/';
  const screen = SCREENS.find((s) => s.route === route) ?? SCREENS[0];
  return `\`\`\`tsx\n${screen?.code ?? ''}\`\`\``;
}

export async function startFakeLlm(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: MODEL }] }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      const body = JSON.parse(raw) as {
        model: string;
        messages: { role: string; content: string }[];
      };
      const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
      // A short delay so the live timeline is observable.
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            model: body.model,
            choices: [{ message: { role: 'assistant', content: answer(system, user) } }],
            usage: { prompt_tokens: 1200, completion_tokens: 400 },
          }),
        );
      }, 300);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
