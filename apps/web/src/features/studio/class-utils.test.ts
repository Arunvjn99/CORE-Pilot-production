import { describe, expect, it } from 'vitest';
import { colorTokens, groupValue, setGroup, splitClasses } from './class-utils';

describe('splitClasses', () => {
  it('splits on any whitespace and drops empty entries', () => {
    expect(splitClasses('  flex\tgap-2\n  p-4  ')).toEqual(['flex', 'gap-2', 'p-4']);
    expect(splitClasses('')).toEqual([]);
    expect(splitClasses('   ')).toEqual([]);
  });
});

describe('groupValue', () => {
  it('finds the current class of a group', () => {
    const cls = 'flex flex-col items-center justify-between gap-4 p-6 px-2 py-1 rounded-lg';
    expect(groupValue(cls, 'display')).toBe('flex');
    expect(groupValue(cls, 'direction')).toBe('flex-col');
    expect(groupValue(cls, 'align')).toBe('items-center');
    expect(groupValue(cls, 'justify')).toBe('justify-between');
    expect(groupValue(cls, 'gap')).toBe('gap-4');
    expect(groupValue(cls, 'padding')).toBe('p-6');
    expect(groupValue(cls, 'paddingX')).toBe('px-2');
    expect(groupValue(cls, 'paddingY')).toBe('py-1');
    expect(groupValue(cls, 'radius')).toBe('rounded-lg');
    expect(groupValue(cls, 'shadow')).toBeNull();
  });

  it('ignores variant-prefixed classes', () => {
    expect(groupValue('hover:bg-red-500 md:flex', 'background')).toBeNull();
    expect(groupValue('hover:bg-red-500 md:flex', 'display')).toBeNull();
    expect(groupValue('md:p-8 p-2', 'padding')).toBe('p-2');
  });

  it('tells text size, alignment and colour apart', () => {
    const cls = 'text-lg text-center text-[var(--color-primary)]';
    expect(groupValue(cls, 'fontSize')).toBe('text-lg');
    expect(groupValue(cls, 'textAlign')).toBe('text-center');
    expect(groupValue(cls, 'textColor')).toBe('text-[var(--color-primary)]');
    expect(groupValue('text-2xl', 'textColor')).toBeNull();
    expect(groupValue('text-[14px]', 'fontSize')).toBe('text-[14px]');
    expect(groupValue('text-[14px]', 'textColor')).toBeNull();
    expect(groupValue('text-slate-700', 'textColor')).toBe('text-slate-700');
    expect(groupValue('text-slate-700', 'fontSize')).toBeNull();
    expect(groupValue('text-wrap text-left', 'textColor')).toBeNull();
  });

  it('recognises arbitrary colour values for fills and borders', () => {
    expect(groupValue('bg-[var(--color-primary)]', 'background')).toBe('bg-[var(--color-primary)]');
    expect(groupValue('bg-[#ff00aa]', 'background')).toBe('bg-[#ff00aa]');
    expect(groupValue('bg-white', 'background')).toBe('bg-white');
    expect(groupValue('bg-gradient-to-r', 'background')).toBeNull();
    expect(groupValue('border border-[var(--color-border)]', 'border')).toBe('border');
    expect(groupValue('border border-[var(--color-border)]', 'borderColor')).toBe(
      'border-[var(--color-border)]',
    );
    expect(groupValue('border-2', 'borderColor')).toBeNull();
  });

  it('does not confuse margin with max-width or padding with padding-x', () => {
    expect(groupValue('max-w-md', 'margin')).toBeNull();
    expect(groupValue('max-w-md', 'width')).toBe('max-w-md');
    expect(groupValue('mx-auto', 'margin')).toBe('mx-auto');
    expect(groupValue('px-4', 'padding')).toBeNull();
  });
});

describe('setGroup', () => {
  it('replaces the class of a group and keeps the others', () => {
    expect(setGroup('flex p-2 gap-4', 'padding', 'p-6')).toBe('flex gap-4 p-6');
  });

  it('removes the group when the value is null', () => {
    expect(setGroup('flex p-2 gap-4', 'gap', null)).toBe('flex p-2');
  });

  it('adds the group when it was absent', () => {
    expect(setGroup('flex', 'align', 'items-center')).toBe('flex items-center');
    expect(setGroup('', 'display', 'grid')).toBe('grid');
  });

  it('preserves variant-prefixed classes of the same group', () => {
    expect(setGroup('p-2 hover:p-4 md:p-8', 'padding', 'p-6')).toBe('hover:p-4 md:p-8 p-6');
    expect(setGroup('bg-white hover:bg-[var(--color-primary)]', 'background', null)).toBe(
      'hover:bg-[var(--color-primary)]',
    );
    expect(setGroup('flex md:hidden', 'display', 'block')).toBe('md:hidden block');
  });

  it('changes text colour without touching size or alignment', () => {
    expect(
      setGroup('text-sm text-center text-slate-700', 'textColor', 'text-[var(--color-accent)]'),
    ).toBe('text-sm text-center text-[var(--color-accent)]');
    expect(setGroup('text-sm text-slate-700', 'fontSize', 'text-xl')).toBe(
      'text-slate-700 text-xl',
    );
  });

  it('replaces arbitrary-value fills', () => {
    expect(setGroup('bg-[var(--color-primary)] p-4', 'background', 'bg-[var(--color-muted)]')).toBe(
      'p-4 bg-[var(--color-muted)]',
    );
  });

  it('removes every duplicate of the group', () => {
    expect(setGroup('p-2 p-4 flex', 'padding', 'p-1')).toBe('flex p-1');
  });
});

describe('colorTokens', () => {
  it('lists unique --color-* declarations in order', () => {
    const css = `:root {
  --color-primary: #0055ff;
  --color-text-muted : rgb(1 2 3);
  --radius-sm: 4px;
  --font-sans: Inter;
  --color-primary: #0044ee;
}
.button { color: var(--color-unused-reference); }`;
    expect(colorTokens(css)).toEqual(['--color-primary', '--color-text-muted']);
  });

  it('returns an empty list without colour tokens', () => {
    expect(colorTokens('')).toEqual([]);
    expect(colorTokens(':root { --radius-sm: 4px; }')).toEqual([]);
  });
});
