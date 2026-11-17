import {
  createDesignSystemSchema,
  type DesignSystem,
  designSystemSchema,
  type DesignSystemSummary,
  designSystemSummarySchema,
  updateDesignSystemSchema,
} from '@core-studio/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCsrfToken } from '../../lib/api-client';
import { json, makeSession } from '../../test-fixtures';
import { SESSION_QUERY_KEY } from '../auth/use-session';
import { DesignSystemsPage } from './design-systems-page';

const TOKENS = `:root {
  --color-primary: #0055ff;
  --color-surface: rgb(255, 255, 255);
  --color-evil: url(https://evil.test/x.png);
  --radius-sm: 4px;
}`;

const summaries: DesignSystemSummary[] = [
  { slug: 'core-2', name: 'CORE 2.0', version: 2, custom: false, customized: true },
  { slug: 'material', name: 'Material', version: 0, custom: false, customized: false },
  { slug: 'brand-x', name: 'Brand X', version: 1, custom: true, customized: true },
].map((s) => designSystemSummarySchema.parse(s));

const system = (slug: string, overrides: Partial<DesignSystem> = {}): DesignSystem => {
  const summary = summaries.find((s) => s.slug === slug);
  return designSystemSchema.parse({
    ...summary,
    designMd: `# ${summary?.name ?? slug}\n\nColours, type and spacing rules.`,
    tokensCss: TOKENS,
    updatedAt: '2026-11-12T09:30:00.000Z',
    updatedByName: 'Ada Lovelace',
    ...overrides,
  });
};

const WRITER: Parameters<typeof makeSession>[0] = {
  permissions: ['members:read', 'projects:read', 'projects:write', 'providers:read'],
};

type Handler = (init: RequestInit | undefined) => Response;
function stubApi(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    'GET /api/v1/studio/design-systems': () => json(200, summaries),
    'GET /api/v1/studio/design-systems/core-2': () => json(200, system('core-2')),
    'GET /api/v1/studio/design-systems/material': () => json(200, system('material')),
    'GET /api/v1/studio/design-systems/brand-x': () => json(200, system('brand-x')),
    ...overrides,
  };
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${path}`];
    return Promise.resolve(handler ? handler(init) : json(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodiesOf = (fetchMock: ReturnType<typeof stubApi>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(([p, init]) => p === path && init?.method === method)
    .map(([, init]) => JSON.parse(init?.body as string) as unknown);

function renderPage(session = makeSession()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(SESSION_QUERY_KEY, session);
  setCsrfToken('csrf');
  return render(
    <QueryClientProvider client={client}>
      <DesignSystemsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DesignSystemsPage', () => {
  it('lists design systems and opens the first one', async () => {
    stubApi();
    renderPage(makeSession(WRITER));
    const nav = screen.getByRole('navigation', { name: 'Design systems' });
    await within(nav).findByRole('button', { name: /Brand X/ });
    expect(
      within(nav)
        .getAllByRole('button', { name: /CORE|Material|Brand/ })
        .map((b) => b.textContent),
    ).toEqual(['CORE 2.0Customised · v2', 'MaterialDefault', 'Brand XCustom']);
    expect(await screen.findByRole('heading', { name: 'CORE 2.0' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('CORE 2.0');
    expect(screen.getByLabelText('tokens.css')).toHaveValue(TOKENS);
  });

  it('previews only safe colour token values', async () => {
    stubApi();
    renderPage(makeSession(WRITER));
    const swatches = await screen.findByRole('list', { name: 'Colour tokens' });
    expect(
      within(swatches)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['primary', 'surface']);
    expect(swatches.innerHTML).not.toContain('evil.test');
  });

  it('saves a new version with the expected version', async () => {
    const fetchMock = stubApi({
      'PUT /api/v1/studio/design-systems/material': (init) => {
        const body = updateDesignSystemSchema.parse(JSON.parse(init?.body as string));
        return json(200, system('material', { ...body, version: 1, customized: true }));
      },
    });
    renderPage(makeSession(WRITER));
    await userEvent.click(await screen.findByRole('button', { name: /Material/ }));
    const name = await screen.findByDisplayValue('Material');
    await userEvent.clear(name);
    await userEvent.type(name, 'Material (team)');
    await userEvent.click(screen.getByRole('button', { name: 'Save new version' }));

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'PUT', '/api/v1/studio/design-systems/material')).toEqual([
        {
          name: 'Material (team)',
          designMd: '# Material\n\nColours, type and spacing rules.',
          tokensCss: TOKENS,
          expectedVersion: 0,
        },
      ]);
    });
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(new Headers(put?.[1]?.headers).get('x-csrf-token')).toBe('csrf');
  });

  it('shows the conflict message when the version is stale', async () => {
    stubApi({
      'PUT /api/v1/studio/design-systems/core-2': () =>
        json(409, {
          error: {
            code: 'STALE_VERSION',
            message: 'Someone saved a newer version. Reload to see it.',
            correlationId: 'corr-1',
          },
        }),
    });
    renderPage(makeSession(WRITER));
    const md = await screen.findByLabelText('DESIGN.md');
    await userEvent.type(md, '\nMore rules.');
    await userEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone saved a newer version. Reload to see it.',
    );
    expect(screen.getByLabelText('DESIGN.md')).toHaveValue(
      '# CORE 2.0\n\nColours, type and spacing rules.\nMore rules.',
    );
  });

  it('creates a new design system and opens it', async () => {
    let created: DesignSystem | null = null;
    const fetchMock = stubApi({
      'POST /api/v1/studio/design-systems': (init) => {
        const body = createDesignSystemSchema.parse(JSON.parse(init?.body as string));
        created = designSystemSchema.parse({
          ...body,
          version: 1,
          custom: true,
          customized: true,
          updatedAt: '2026-11-17T09:00:00.000Z',
          updatedByName: 'Ada Lovelace',
        });
        return json(201, created);
      },
      'GET /api/v1/studio/design-systems/acme': () => json(200, created),
    });
    renderPage(makeSession(WRITER));
    await userEvent.click(await screen.findByRole('button', { name: 'New design system' }));
    expect(screen.getByRole('heading', { name: 'New design system' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Acme');
    await userEvent.type(screen.getByLabelText('Id'), 'acme');
    await userEvent.type(screen.getByLabelText('tokens.css'), ':root {{ --color-brand: #ff0000; }');
    await userEvent.click(screen.getByRole('button', { name: 'Create design system' }));

    await waitFor(() => {
      expect(bodiesOf(fetchMock, 'POST', '/api/v1/studio/design-systems')).toEqual([
        {
          slug: 'acme',
          name: 'Acme',
          designMd: '# Design system\n\n## Colour\n\n## Typography\n',
          tokensCss: ':root { --color-brand: #ff0000; }',
        },
      ]);
    });
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save new version' })).toBeInTheDocument();
  });

  it('is read-only without projects:write', async () => {
    const fetchMock = stubApi();
    renderPage();
    expect(await screen.findByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('DESIGN.md')).toBeDisabled();
    expect(screen.getByLabelText('tokens.css')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save new version' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New design system' })).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(
      false,
    );
  });

  it('reports when the design systems cannot be loaded', async () => {
    stubApi({ 'GET /api/v1/studio/design-systems': () => json(500, {}) });
    renderPage(makeSession(WRITER));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Design systems could not be loaded.',
    );
  });
});
