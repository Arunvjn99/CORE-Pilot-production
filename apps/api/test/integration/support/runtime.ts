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
