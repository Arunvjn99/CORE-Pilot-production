import { describe, expect, it } from 'vitest';
import { buildLayerTree } from './picker';

const html = (markup: string) => {
  const root = document.createElement('div');
  root.innerHTML = markup;
  return root;
};

describe('buildLayerTree', () => {
  it('nests located elements, names them by text or attributes, and lifts unlocated wrappers', () => {
    const tree = buildLayerTree(
      html(`
        <main data-core-loc="3:4">
          <h1 data-core-loc="4:6">Welcome   back</h1>
          <div>
            <input data-core-loc="6:8" placeholder="Work email" />
          </div>
          <button data-core-loc="8:6" data-link="/dashboard"><span>Go</span></button>
        </main>`),
    );
    expect(tree).toEqual([
      {
        line: 3,
        column: 4,
        tag: 'main',
        label: '',
        children: [
          { line: 4, column: 6, tag: 'h1', label: 'Welcome back', children: [] },
          { line: 6, column: 8, tag: 'input', label: 'Work email', children: [] },
          { line: 8, column: 6, tag: 'button', label: 'Go', children: [] },
        ],
      },
    ]);
  });

  it('caps very large trees', () => {
    const many = Array.from(
      { length: 3000 },
      (_, i) => `<p data-core-loc="${String(i + 1)}:0">x</p>`,
    ).join('');
    const tree = buildLayerTree(html(`<section data-core-loc="1:0">${many}</section>`));
    expect(tree[0]?.children.length).toBeLessThanOrEqual(500);
  });
});
