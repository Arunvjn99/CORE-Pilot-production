import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Agents of the design graph, in pipeline order (services/ai-runtime design graph). */
export const AGENT_KEYS = ['orchestrator', 'ux', 'ui', 'reviewer'] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export interface DefaultAgent {
  key: AgentKey;
  name: string;
  description: string;
  /** AGENT.md body (without front matter). */
  instructions: string;
}

export interface DefaultDesignSystem {
  slug: string;
  name: string;
  designMd: string;
  tokensCss: string;
}

/** Token names every design system must define, so generated screens work with any of them. */
export const REQUIRED_TOKENS = [
  '--color-primary',
  '--color-primary-hover',
  '--color-on-primary',
  '--color-surface',
  '--color-surface-2',
  '--color-text',
  '--color-text-muted',
  '--color-border',
  '--color-success',
  '--color-warning',
  '--color-danger',
  '--color-info',
  '--font-sans',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--shadow-1',
  '--focus-ring',
] as const;

export const DEFAULT_DESIGN_SYSTEM = 'core-2';

const root = (dir: string) => fileURLToPath(new URL(`../${dir}`, import.meta.url));

/** Parses `---\nkey: value\n---\nbody`. Only simple `key: value` lines are supported. */
export function parseFrontMatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: (match[2] ?? '').trimStart() };
}

export async function loadDefaultAgents(): Promise<DefaultAgent[]> {
  return Promise.all(
    AGENT_KEYS.map(async (key) => {
      const { meta, body } = parseFrontMatter(
        await readFile(join(root('agents'), `${key}.md`), 'utf8'),
      );
      return {
        key,
        name: meta['name'] ?? key,
        description: meta['description'] ?? '',
        instructions: body,
      };
    }),
  );
}

/** Missing required tokens in a tokens.css text (empty array = valid). */
export function missingTokens(tokensCss: string): string[] {
  return REQUIRED_TOKENS.filter((t) => !new RegExp(`${t}\\s*:`).test(tokensCss));
}

export async function loadDefaultDesignSystems(): Promise<DefaultDesignSystem[]> {
  const dir = root('design-systems');
  const slugs = (await readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const systems = await Promise.all(
    slugs.map(async (slug) => {
      const designMd = await readFile(join(dir, slug, 'DESIGN.md'), 'utf8');
      const tokensCss = await readFile(join(dir, slug, 'tokens.css'), 'utf8');
      const title = /^#\s+(.+)$/m.exec(designMd)?.[1] ?? slug;
      const name = title
        .replace(/^Design System Inspired by\s+/i, '')
        .replace(/\s+Design System$/i, '');
      return { slug, name, designMd, tokensCss };
    }),
  );
  return systems.sort((a, b) =>
    a.slug === DEFAULT_DESIGN_SYSTEM
      ? -1
      : b.slug === DEFAULT_DESIGN_SYSTEM
        ? 1
        : a.name.localeCompare(b.name),
  );
}
