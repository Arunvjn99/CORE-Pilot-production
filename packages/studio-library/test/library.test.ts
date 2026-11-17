import { describe, expect, it } from 'vitest';
import {
  AGENT_KEYS,
  DEFAULT_DESIGN_SYSTEM,
  loadDefaultAgents,
  loadDefaultDesignSystems,
  missingTokens,
  parseFrontMatter,
} from '../src/index.js';

describe('studio library', () => {
  it('ships an AGENT.md for every agent in the graph', async () => {
    const agents = await loadDefaultAgents();
    expect(agents.map((a) => a.key)).toEqual([...AGENT_KEYS]);
    for (const agent of agents) {
      expect(agent.name).not.toBe(agent.key);
      expect(agent.instructions.length).toBeGreaterThan(200);
      expect(agent.instructions).not.toContain('---');
    }
  });

  it('ships CORE 2.0 first and every design system defines all required tokens', async () => {
    const systems = await loadDefaultDesignSystems();
    expect(systems[0]?.slug).toBe(DEFAULT_DESIGN_SYSTEM);
    expect(systems[0]?.name).toBe('CORE 2.0');
    for (const system of systems) expect(missingTokens(system.tokensCss), system.slug).toEqual([]);
  });

  it('parses front matter and reports missing tokens', () => {
    expect(parseFrontMatter('---\nname: A\n---\nBody')).toEqual({
      meta: { name: 'A' },
      body: 'Body',
    });
    expect(missingTokens(':root { --color-primary: red; }')).toContain('--color-text');
  });
});
