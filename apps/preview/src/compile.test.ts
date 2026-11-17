import { describe, expect, it } from 'vitest';
import { compileScreen } from './compile';

describe('compileScreen', () => {
  it('compiles TSX and tags intrinsic elements with their original source location', () => {
    const code = `import { useState } from 'react';
export default function Home(): JSX.Element {
  const [n] = useState<number>(1);
  return (
    <main className="p-4">
      <Card />
      <h1>Hi {n}</h1>
    </main>
  );
}`;
    const out = compileScreen(code, 'src/pages/home/HomePage.tsx');
    expect(out).toContain('"data-core-loc": "5:4"');
    expect(out).toContain('"data-core-loc": "7:6"');
    expect(out).not.toContain('Card, {\n    "data-core-loc"');
    expect(out).toContain('exports.default');
    expect(out).toContain('require("react")');
  });

  it('rejects invalid source', () => {
    expect(() => compileScreen('export default function () { return <div> }', 'x.tsx')).toThrow();
  });
});
