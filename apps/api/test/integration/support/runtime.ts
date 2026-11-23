import { type ChildProcess, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const RUNTIME_DIR = fileURLToPath(new URL('../../../../../services/ai-runtime', import.meta.url));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export interface RealRuntime {
  url: string;
  stop: () => Promise<void>;
}

/**
 * Starts the real AI runtime (uvicorn) with the same LOCAL_KEK as the API and service-token
 * validation against the mock IdP. Nothing on the API → runtime path is stubbed.
 */
export async function startRuntime(env: {
  localKek: string;
  issuer: string;
  audience: string;
  allowedCaller: string;
}): Promise<RealRuntime> {
  const port = await freePort();
  const child: ChildProcess = spawn(
    'uv',
    [
      'run',
      '--frozen',
      'uvicorn',
      'ai_runtime.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: RUNTIME_DIR,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        APP_ENV: 'test',
        LOG_LEVEL: 'WARNING',
        LOCAL_KEK: env.localKek,
        SERVICE_AUTH_ISSUER: env.issuer,
        SERVICE_AUTH_AUDIENCE: env.audience,
        SERVICE_AUTH_ALLOWED_CALLERS: env.allowedCaller,
        PROVIDER_TIMEOUT_SECONDS: '5',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const url = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/health/live`)).ok) break;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`AI runtime failed to start:\n${stderr.slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    url,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    },
  };
}

export interface FakeProvider {
  /** Base URL to store as an Ollama endpoint. */
  url: string;
  /** Authorization headers received, to prove the runtime decrypted the right secret. */
  seenAuthorization: string[];
  close: () => Promise<void>;
}

/**
 * Stand-in for a self-hosted Ollama server (the only external party in these tests).
 * Requires `Bearer <expectedSecret>`; returns 401 otherwise.
 */
export async function startFakeOllama(
  expectedSecret: string,
  models: string[],
): Promise<FakeProvider> {
  const seenAuthorization: string[] = [];
  const server: Server = createServer((req, res) => {
    seenAuthorization.push(req.headers.authorization ?? '');
    if (req.url !== '/api/tags') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${expectedSecret}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream-detail-must-not-leak' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    seenAuthorization,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

export type DesignRole = 'plan' | 'ux' | 'ui' | 'review';

export interface FakeDesignProvider extends FakeProvider {
  /** Role of every chat call received, in order (derived from the output contract). */
  calls: DesignRole[];
  /** Models requested per role, to prove per-agent model overrides reach the provider. */
  models: { role: DesignRole; model: string }[];
  /** System and user messages per call, to prove what the agents were given. */
  prompts: { role: DesignRole; system: string; user: string }[];
  /** Changes the behaviour for the next runs. */
  set: (behaviour: Partial<DesignBehaviour>) => void;
}

export interface DesignBehaviour {
  /** Screens the orchestrator plans. */
  screens: { name: string; route: string }[];
  /** Reviewer verdict per round: false makes the first review fail and triggers one fix round. */
  passFirstReview: boolean;
  /** UI output that is not a valid screen (the API must refuse to save it). */
  invalidUi: boolean;
  /** HTTP status for every chat call (e.g. 500 to simulate an outage). */
  status: number;
  /** Delay before each answer, to keep a run in progress. */
  delayMs: number;
}

const roleOf = (system: string): DesignRole => {
  if (system.includes('"title": string, "summary": string')) return 'plan';
  if (system.includes('"layout": string')) return 'ux';
  if (system.includes('"score": 0-100')) return 'review';
  return 'ui';
};

const componentName = (name: string) =>
  name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Screen';

/** A deterministic screen: heading, a link to the next screen and a button (for canvas edits). */
export const fakeScreenCode = (name: string, linkTo: string) =>
  [
    `export default function ${componentName(name)}() {`,
    '  return (',
    '    <main className="p-8 bg-[var(--color-surface)]">',
    `      <h1 className="text-2xl text-[var(--color-text)]">${name}</h1>`,
    `      <button className="px-4 py-2 bg-[var(--color-primary)]" data-link="${linkTo}">Continue</button>`,
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');

/**
 * Ollama stand-in for design runs: answers OpenAI-compatible /v1/chat/completions with plan, UX,
 * UI and review output chosen by the system prompt's output contract, plus usage numbers.
 */
export async function startFakeDesignOllama(expectedSecret: string): Promise<FakeDesignProvider> {
  const seenAuthorization: string[] = [];
  const calls: DesignRole[] = [];
  const models: { role: DesignRole; model: string }[] = [];
  const prompts: { role: DesignRole; system: string; user: string }[] = [];
  const behaviour: DesignBehaviour = {
    screens: [
      { name: 'Sign in', route: '/' },
      { name: 'Dashboard', route: '/dashboard' },
    ],
    passFirstReview: true,
    invalidUi: false,
    status: 200,
    delayMs: 0,
  };
  let reviews = 0;
  const answer = (role: DesignRole, user: string): string => {
    switch (role) {
      case 'plan':
        reviews = 0;
        return JSON.stringify({
          title: 'Account area',
          summary: 'Sign in and a dashboard',
          screens: behaviour.screens.map((s, i) => ({
            ...s,
            purpose: `Purpose of ${s.name}`,
            links: [behaviour.screens[(i + 1) % behaviour.screens.length]?.route ?? '/'],
          })),
          todos: ['Plan', 'Build', 'Review'],
        });
      case 'ux':
        return `Here you go: ${JSON.stringify({
          screens: behaviour.screens.map((s) => ({
            route: s.route,
            layout: 'single column',
            sections: [{ name: 'Main', content: s.name }],
            primaryAction: 'Continue',
            navigation: [],
          })),
        })}`;
      case 'ui': {
        const match = /Screen: (.+) \((\/[^)]*)\)/.exec(user);
        const name = match?.[1] ?? 'Screen';
        const route = match?.[2] ?? '/';
        const index = behaviour.screens.findIndex((s) => s.route === route);
        const next = behaviour.screens[(index + 1) % behaviour.screens.length]?.route ?? '/';
        const code = behaviour.invalidUi
          ? `export default function Broken() { return <div><span></div>; }`
          : fakeScreenCode(name, next);
        return `\`\`\`tsx\n${code}\`\`\``;
      }
      case 'review': {
        reviews += 1;
        const pass = behaviour.passFirstReview || reviews > 1;
        return JSON.stringify({
          screens: behaviour.screens.map((s) => ({
            route: s.route,
            score: pass ? 92 : 55,
            pass,
            checks: [{ id: 'tokens', pass, note: pass ? 'Uses tokens' : 'Hard-coded colour' }],
            fixes: pass ? [] : ['Use the primary token'],
          })),
        });
      }
    }
  };
  const server: Server = createServer((req, res) => {
    seenAuthorization.push(req.headers.authorization ?? '');
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${expectedSecret}`) {
      res.writeHead(401).end();
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
      const role = roleOf(system);
      calls.push(role);
      models.push({ role, model: body.model });
      prompts.push({ role, system, user });
      setTimeout(() => {
        if (behaviour.status !== 200) {
          res.writeHead(behaviour.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'upstream-detail-must-not-leak' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            model: body.model,
            choices: [{ message: { role: 'assistant', content: answer(role, user) } }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
        );
      }, behaviour.delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    seenAuthorization,
    calls,
    models,
    prompts,
    set: (next) => Object.assign(behaviour, next),
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}
