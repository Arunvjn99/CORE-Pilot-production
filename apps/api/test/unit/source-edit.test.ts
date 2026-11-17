import { describe, expect, it } from 'vitest';
import {
  applySourceEdit,
  isValidScreen,
  type SourceEditError,
} from '../../src/studio/source-edit.js';

const code = `export default function HomePage() {
  return (
    <main className="p-4">
      <h1 className="text-2xl">Welcome</h1>
      <button data-link="/next" className={cx}>Go</button>
      <p>Hello <b>you</b></p>
    </main>
  );
}
`;
// <h1 starts on line 4, column 6; <main on line 3 col 4; <button line 5 col 6; <p line 6 col 6.

describe('source edits', () => {
  it('replaces text and keeps the rest of the file byte for byte', () => {
    const next = applySourceEdit(code, {
      line: 4,
      column: 6,
      op: { type: 'setText', text: 'Hi there' },
    });
    expect(next).toBe(code.replace('>Welcome<', '>Hi there<'));
  });

  it('escapes text that would break JSX', () => {
    const next = applySourceEdit(code, {
      line: 4,
      column: 6,
      op: { type: 'setText', text: '{evil} <script>' },
    });
    expect(next).toContain('<h1 className="text-2xl">{"{evil} <script>"}</h1>');
  });

  it('sets, adds and removes attributes', () => {
    expect(
      applySourceEdit(code, {
        line: 3,
        column: 4,
        op: { type: 'setClassName', className: 'p-8 bg-white' },
      }),
    ).toContain('<main className="p-8 bg-white">');
    expect(
      applySourceEdit(code, {
        line: 4,
        column: 6,
        op: { type: 'setAttribute', name: 'data-link', value: '/pricing' },
      }),
    ).toContain('<h1 data-link="/pricing" className="text-2xl">');
    expect(
      applySourceEdit(code, {
        line: 5,
        column: 6,
        op: { type: 'setAttribute', name: 'data-link', value: null },
      }),
    ).toContain('<button className={cx}>');
  });

  it('refuses computed attributes, mixed content and unknown locations', () => {
    const fail = (edit: Parameters<typeof applySourceEdit>[1], code_: string) => {
      try {
        applySourceEdit(code, edit);
        return null;
      } catch (error) {
        return (error as SourceEditError).code === code_;
      }
    };
    expect(
      fail({ line: 5, column: 6, op: { type: 'setClassName', className: 'x' } }, 'UNSUPPORTED'),
    ).toBe(true);
    expect(fail({ line: 6, column: 6, op: { type: 'setText', text: 'x' } }, 'UNSUPPORTED')).toBe(
      true,
    );
    expect(
      fail({ line: 9, column: 0, op: { type: 'setText', text: 'x' } }, 'ELEMENT_NOT_FOUND'),
    ).toBe(true);
  });

  it('validates generated screens', () => {
    expect(isValidScreen(code)).toBe(true);
    expect(isValidScreen('export default function A() { return <div> }')).toBe(false);
    expect(isValidScreen('const A = () => <div />;')).toBe(false);
  });
});
