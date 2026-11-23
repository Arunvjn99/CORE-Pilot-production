import { verifyIssueSchema, type VerifyIssue } from '@core-studio/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  axeIssues,
  designSystemChecks,
  hardCodedColorClasses,
  hardCodedStyleColors,
  mergeIssues,
  runAxe,
  sourceLocation,
  verifyScreen,
} from './verify';

const html = (markup: string) => {
  const root = document.createElement('div');
  root.innerHTML = markup;
  document.body.append(root);
  return root;
};

/** jsdom has no layout: give elements a size. */
const size = (el: Element | null, width: number, height: number) => {
  if (!el) throw new Error('missing element');
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('sourceLocation', () => {
  it("uses the element's own location, else its nearest located ancestor inside the root", () => {
    const root = html(`
      <main data-core-loc="3:4">
        <div><span id="deep">x</span></div>
        <p id="own" data-core-loc="7:8">y</p>
      </main>`);
    expect(sourceLocation(root.querySelector('#own'), root)).toEqual({ line: 7, column: 8 });
    expect(sourceLocation(root.querySelector('#deep'), root)).toEqual({ line: 3, column: 4 });
  });

  it('does not look outside the root and ignores malformed locations', () => {
    const outer = html(
      '<section data-core-loc="1:0"><div id="root"><b data-core-loc="x:1">z</b></div></section>',
    );
    const root = outer.querySelector('#root');
    if (!root) throw new Error('missing root');
    expect(sourceLocation(root.querySelector('b'), root)).toBeNull();
    expect(sourceLocation(null, root)).toBeNull();
  });
});

describe('hard-coded colours', () => {
  it('finds arbitrary colour values and palette colours in classes, but not tokens', () => {
    expect(
      hardCodedColorClasses(
        'bg-[#123456] hover:text-[rgb(0_0_0)] border-x-[#fff]/50 [color:#abc] shadow-[0_0_0_1px_#000] text-[14px] bg-[var(--color-surface)] p-4',
      ),
    ).toEqual({
      arbitrary: [
        'bg-[#123456]',
        'hover:text-[rgb(0_0_0)]',
        'border-x-[#fff]/50',
        '[color:#abc]',
        'shadow-[0_0_0_1px_#000]',
      ],
      palette: [],
    });
    expect(hardCodedColorClasses('bg-blue-500 md:text-white text-black/50 text-sm')).toEqual({
      arbitrary: [],
      palette: ['bg-blue-500', 'md:text-white', 'text-black/50'],
    });
  });

  it('finds literal colours in inline styles, but not tokens or non-colour properties', () => {
    expect(
      hardCodedStyleColors(
        'color: #333; background-color: rgba(0,0,0,.5); border: 1px solid black; padding: 4px; fill: var(--color-primary)',
      ),
    ).toEqual(['color: #333', 'background-color: rgba(0,0,0,.5)', 'border: 1px solid black']);
  });
});

describe('designSystemChecks', () => {
  it('reports each problem once per element, located in the source', () => {
    const root = html(`
      <main data-core-loc="2:4">
        <h1 data-core-loc="3:6" class="bg-[#123456] text-red-600">Title</h1>
        <p data-core-loc="4:6" style="color: #333; font-size: 10px">Small print</p>
        <img data-core-loc="5:6" src="a.png" />
        <div role="img" data-core-loc="6:6"></div>
        <img data-core-loc="7:6" src="b.png" alt="" />
        <p data-core-loc="8:6" style="font-size: 12px">Fine</p>
      </main>`);
    const issues = designSystemChecks(root);
    for (const i of issues) expect(verifyIssueSchema.safeParse(i).success).toBe(true);
    expect(issues.map((i) => [i.id, i.severity, i.line, i.column])).toEqual([
      ['ds-hardcoded-color', 'moderate', 3, 6],
      ['ds-palette-color', 'minor', 3, 6],
      ['ds-inline-color', 'moderate', 4, 6],
      ['ds-text-size', 'moderate', 4, 6],
      ['ds-image-alt', 'critical', 5, 6],
      ['ds-image-alt', 'critical', 6, 6],
    ]);
    expect(issues.every((i) => i.category === 'design-system')).toBe(true);
    expect(issues[3]?.message).toBe('Text is 10px, below the 12px minimum.');
  });

  it('skips small text that is hidden', () => {
    const root = html(`
      <div data-core-loc="1:0" aria-hidden="true"><span style="font-size: 8px">x</span></div>
      <div data-core-loc="2:0" style="display: none"><span style="font-size: 8px">y</span></div>`);
    expect(designSystemChecks(root)).toEqual([]);
  });

  it('flags interactive elements smaller than 24×24, except inline links and unlaid-out elements', () => {
    const root = html(`
      <div data-core-loc="1:0">
        <button id="small" data-core-loc="2:2">x</button>
        <button id="ok" data-core-loc="3:2">Continue</button>
        <div id="link" data-core-loc="4:2" data-link="/next">Go</div>
        <p data-core-loc="5:2">Read the <a id="inline" href="/terms">terms</a> first.</p>
        <button id="unsized" data-core-loc="6:2">?</button>
      </div>`);
    size(root.querySelector('#small'), 16, 16);
    size(root.querySelector('#ok'), 120, 40);
    size(root.querySelector('#link'), 40, 20);
    size(root.querySelector('#inline'), 30, 14);
    const issues = designSystemChecks(root);
    expect(issues.map((i) => [i.id, i.line, i.message])).toEqual([
      ['ds-target-size', 2, 'Touch target is 16×16px, smaller than 24×24px.'],
      ['ds-target-size', 4, 'Touch target is 40×20px, smaller than 24×24px.'],
    ]);
  });

  it('locates issues on unlocated elements (inside components) at the nearest located ancestor', () => {
    const root = html(
      '<section data-core-loc="9:2"><div><span class="text-[#f00]">x</span></div></section>',
    );
    expect(designSystemChecks(root)).toMatchObject([
      { id: 'ds-hardcoded-color', line: 9, column: 2 },
    ]);
  });
});

describe('axe results', () => {
  it('maps violations to issues at each node’s source location', () => {
    const root = html(
      '<main data-core-loc="1:0"><div><button data-core-loc="4:6"></button></div></main>',
    );
    const button = root.querySelector('button');
    const issues = axeIssues(root, [
      {
        id: 'button-name',
        impact: 'critical',
        help: 'Buttons must have discernible text',
        nodes: [
          {
            element: button,
            failureSummary: 'Fix any of the following:\n  Element does not have inner text',
          },
          { element: null },
        ],
      },
      {
        id: 'odd-rule',
        impact: null,
        help: 'x'.repeat(400),
        nodes: [{ element: root.querySelector('div') }],
      },
    ]);
    expect(issues).toEqual([
      {
        id: 'button-name',
        severity: 'critical',
        category: 'accessibility',
        message: 'Fix any of the following: Element does not have inner text',
        help: 'Buttons must have discernible text',
        line: 4,
        column: 6,
      },
      {
        id: 'button-name',
        severity: 'critical',
        category: 'accessibility',
        message: 'Buttons must have discernible text',
        help: 'Buttons must have discernible text',
      },
      expect.objectContaining({ id: 'odd-rule', severity: 'moderate', line: 1, column: 0 }),
    ]);
    expect(issues[2]?.help.length).toBe(300);
  });

  it('runs the bundled axe-core with WCAG tags and finds an unnamed button', async () => {
    const root = html(
      '<main data-core-loc="1:0"><button data-core-loc="2:4"></button><img data-core-loc="3:4" src="x.png"></main>',
    );
    const issues = await runAxe(root);
    expect(issues).toContainEqual(
      expect.objectContaining({ id: 'button-name', category: 'accessibility', line: 2, column: 4 }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ id: 'image-alt', line: 3, column: 4 }));
  }, 20_000);
});

describe('mergeIssues / verifyScreen', () => {
  const make = (over: Partial<VerifyIssue>): VerifyIssue => ({
    id: 'x',
    severity: 'minor',
    category: 'design-system',
    message: 'm',
    help: 'h',
    ...over,
  });

  it('drops design-system findings axe already reported for the same element and sorts by severity', () => {
    const merged = mergeIssues(
      [
        make({
          id: 'image-alt',
          severity: 'critical',
          category: 'accessibility',
          line: 5,
          column: 6,
        }),
        make({
          id: 'target-size',
          severity: 'serious',
          category: 'accessibility',
          line: 2,
          column: 2,
        }),
      ],
      [
        make({ id: 'ds-palette-color', line: 1, column: 0 }),
        make({ id: 'ds-image-alt', severity: 'critical', line: 5, column: 6 }),
        make({ id: 'ds-target-size', severity: 'serious', line: 2, column: 2 }),
        make({ id: 'ds-target-size', severity: 'serious', line: 3, column: 2 }),
      ],
    );
    expect(merged.map((i) => `${i.id}@${String(i.line)}`)).toEqual([
      'image-alt@5',
      'target-size@2',
      'ds-target-size@3',
      'ds-palette-color@1',
    ]);
  });

  it('caps the result at 200 issues', async () => {
    const many = Array.from(
      { length: 250 },
      (_, i) => `<p data-core-loc="${String(i + 1)}:0" class="bg-[#000]">x</p>`,
    ).join('');
    const issues = await verifyScreen(html(many), () => Promise.resolve([]));
    expect(issues).toHaveLength(200);
  });
});
