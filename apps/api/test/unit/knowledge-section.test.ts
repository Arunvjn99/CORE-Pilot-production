import { describe, expect, it } from 'vitest';
import { knowledgeSection } from '../../src/knowledge/knowledge.service.js';
import { designContext } from '../../src/studio/design-context.js';

const doc = (n: number, body: string) => ({
  id: `id-${String(n)}`,
  title: `Doc ${String(n)}`,
  body,
});

describe('knowledgeSection', () => {
  it('is empty without documents', () => {
    expect(knowledgeSection([])).toEqual({ markdown: '', used: [] });
  });

  it('titles each document under a Team knowledge heading, in order', () => {
    const { markdown, used } = knowledgeSection([
      doc(1, ' Say "member", never "user". '),
      doc(2, 'APR is 4.9%.'),
    ]);
    expect(markdown.startsWith('## Team knowledge\n')).toBe(true);
    expect(markdown).toContain(
      '### Doc 1\n\nSay "member", never "user".\n\n### Doc 2\n\nAPR is 4.9%.',
    );
    expect(used).toEqual([
      { id: 'id-1', title: 'Doc 1', truncated: false },
      { id: 'id-2', title: 'Doc 2', truncated: false },
    ]);
  });

  it('cuts the document that overflows the budget and leaves the rest out, with a note', () => {
    const { markdown, used } = knowledgeSection(
      [doc(1, 'a'.repeat(400)), doc(2, 'b'.repeat(5000)), doc(3, 'c'), doc(4, 'd')],
      2000,
    );
    expect(markdown.length).toBeLessThanOrEqual(2000);
    expect(markdown).toContain('Omitted: the rest of "Doc 2", 2 more documents.');
    expect(markdown).not.toContain('### Doc 3');
    expect(used).toEqual([
      { id: 'id-1', title: 'Doc 1', truncated: false },
      { id: 'id-2', title: 'Doc 2', truncated: true },
    ]);
  });

  it('leaves a document out entirely when too little room is left for it', () => {
    const { markdown, used } = knowledgeSection(
      [doc(1, 'a'.repeat(1700)), doc(2, 'b'.repeat(500))],
      2000,
    );
    expect(used.map((u) => u.id)).toEqual(['id-1']);
    expect(markdown).toContain('Omitted: "Doc 2".');
  });
});

describe('designContext', () => {
  it('appends tokens and then team knowledge after DESIGN.md', () => {
    const text = designContext('# DS', ':root{}', '## Team knowledge\n\nx');
    expect(text.indexOf('# DS')).toBeLessThan(text.indexOf('## tokens.css'));
    expect(text.indexOf('## tokens.css')).toBeLessThan(text.indexOf('## Team knowledge'));
    expect(designContext('# DS', ':root{}', '')).not.toContain('Team knowledge');
  });
});
