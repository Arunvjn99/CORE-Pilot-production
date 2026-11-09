import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DEPENDENCIES,
  componentNameFor,
  MANAGED_FILES,
  parseManifest,
  renderPageStub,
  renderProject,
  renderRoutes,
  slugify,
  templateDir,
  uniqueFolder,
} from '../src/index.js';

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const ids = [
  '8e2b3c1d-0a4f-4b5c-9d6e-7f8091a2b3c4',
  '9f3c4d2e-1b5a-4c6d-8e7f-8091a2b3c4d5',
  'a04d5e3f-2c6b-4d7e-9f80-91a2b3c4d5e6',
];

describe('naming', () => {
  it('derives folders and component names', () => {
    expect(slugify('Getting Started')).toBe('getting-started');
    expect(slugify('***')).toBe('page');
    expect(componentNameFor('getting-started')).toBe('GettingStartedPage');
    expect(componentNameFor('404')).toBe('Page404');
    expect(uniqueFolder('Pricing', ['pricing', 'pricing-2'])).toBe('pricing-3');
  });

  it('emits page titles as string literals, never raw JSX', () => {
    const stub = renderPageStub({ component: 'EvilPage', name: '</h1><script>{alert(1)}' });
    expect(stub).toContain('{"</h1><script>{alert(1)}"}');
  });
});

describe('template', () => {
  it('pins exactly the allow-listed dependencies', async () => {
    const pkg = JSON.parse(await readFile(join(templateDir(), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).toEqual(ALLOWED_DEPENDENCIES);
    const own = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    for (const [name, version] of Object.entries(ALLOWED_DEPENDENCIES))
      expect(own.devDependencies[name], name).toBe(version);
  });

  it('renders a project with a manifest, routes and pages', async () => {
    const { files, manifest } = await renderProject([
      { id: ids[0] ?? '', name: 'Home', route: '/' },
      { id: ids[1] ?? '', name: 'Pricing', route: '/pricing' },
    ]);
    expect(manifest.pages.map((p) => p.component)).toEqual(['HomePage', 'PricingPage']);
    expect(files.has('src/pages/pricing/PricingPage.tsx')).toBe(true);
    expect(files.has('.gitignore')).toBe(true);
    for (const managed of MANAGED_FILES) expect(files.has(managed), managed).toBe(true);
    expect(parseManifest(files.get('core.project.json')?.toString() ?? '')).toEqual(manifest);
    expect(renderRoutes(manifest)).toContain(
      `{ path: "/pricing", Component: lazy(() => import("../pages/pricing/PricingPage")) }`,
    );
  });
});

/** The generated app must pass the same checks a developer would run: tsc and vite build. */
describe('generated app', () => {
  it('typechecks and builds', { timeout: 120_000 }, async () => {
    const out = join(packageRoot, '.generated', 'app');
    await rm(out, { recursive: true, force: true });
    const { files } = await renderProject([
      { id: ids[0] ?? '', name: 'Home', route: '/' },
      { id: ids[1] ?? '', name: 'Pricing', route: '/pricing' },
      { id: ids[2] ?? '', name: 'Getting Started', route: '/docs/getting-started' },
    ]);
    for (const [path, content] of files) {
      await mkdir(dirname(join(out, path)), { recursive: true });
      await writeFile(join(out, path), content);
    }
    const bin = (name: string) => join(packageRoot, 'node_modules', '.bin', name);
    await run(bin('tsc'), ['--noEmit', '-p', 'tsconfig.json'], { cwd: out });
    await run(bin('vite'), ['build', '--logLevel', 'error'], { cwd: out });
    const html = await readFile(join(out, 'dist', 'index.html'), 'utf8');
    expect(html).toContain('<div id="root">');
  });
});
