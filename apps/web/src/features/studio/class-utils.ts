/**
 * Tailwind class editing for the Design panel. Each property is a "group" of mutually exclusive
 * utilities; setting a value removes every class of that group and adds the new one. Variant-prefixed
 * classes (hover:, md:, focus-visible:) are left untouched.
 */
export type ClassGroup =
  | 'display'
  | 'direction'
  | 'wrap'
  | 'align'
  | 'justify'
  | 'gap'
  | 'padding'
  | 'paddingX'
  | 'paddingY'
  | 'margin'
  | 'width'
  | 'height'
  | 'fontSize'
  | 'fontWeight'
  | 'textAlign'
  | 'textColor'
  | 'background'
  | 'radius'
  | 'border'
  | 'borderColor'
  | 'shadow'
  | 'opacity'
  | 'position';

const COLOR_ARBITRARY = /^\[(var\(--[a-z0-9-]+\)|#[0-9a-fA-F]{3,8})\]$/;
const SIZES = /^(xs|sm|base|lg|xl|[2-9]xl)$|^\[\d+(px|rem)\]$/;

const MATCHERS: Record<ClassGroup, (c: string) => boolean> = {
  display: (c) =>
    /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents)$/.test(c),
  direction: (c) => /^flex-(row|col)(-reverse)?$/.test(c),
  wrap: (c) => /^flex-(wrap|nowrap|wrap-reverse)$/.test(c),
  align: (c) => /^items-/.test(c),
  justify: (c) => /^justify-/.test(c),
  gap: (c) => /^gap-/.test(c),
  padding: (c) => /^p-/.test(c),
  paddingX: (c) => /^px-/.test(c),
  paddingY: (c) => /^py-/.test(c),
  margin: (c) => /^m[xytrbl]?-/.test(c),
  width: (c) => /^(w-|min-w-|max-w-)/.test(c),
  height: (c) => /^(h-|min-h-)/.test(c),
  fontSize: (c) => c.startsWith('text-') && SIZES.test(c.slice(5)),
  fontWeight: (c) =>
    /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(c),
  textAlign: (c) => /^text-(left|center|right|justify)$/.test(c),
  textColor: (c) =>
    c.startsWith('text-') &&
    !SIZES.test(c.slice(5)) &&
    !/^text-(left|center|right|justify|wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(c),
  background: (c) =>
    c.startsWith('bg-') && (COLOR_ARBITRARY.test(c.slice(3)) || /^bg-[a-z]+(-\d+)?$/.test(c)),
  radius: (c) => /^rounded(-|$)/.test(c),
  border: (c) => /^border(-[0-4]|-\[\d+px\])?$/.test(c),
  borderColor: (c) => c.startsWith('border-') && COLOR_ARBITRARY.test(c.slice(7)),
  shadow: (c) => /^shadow(-|$)/.test(c),
  opacity: (c) => /^opacity-/.test(c),
  position: (c) => /^(static|relative|absolute|fixed|sticky)$/.test(c),
};

export function splitClasses(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

/** The current (unprefixed) class of a group, or null. */
export function groupValue(className: string, group: ClassGroup): string | null {
  return splitClasses(className).find((c) => !c.includes(':') && MATCHERS[group](c)) ?? null;
}

export function setGroup(className: string, group: ClassGroup, value: string | null): string {
  const kept = splitClasses(className).filter((c) => c.includes(':') || !MATCHERS[group](c));
  return [...kept, ...(value ? [value] : [])].join(' ');
}

/** Colour tokens declared in the design system's tokens.css (`--color-*`). */
export function colorTokens(tokensCss: string): string[] {
  const names = new Set<string>();
  for (const match of tokensCss.matchAll(/(--color-[a-z0-9-]+)\s*:/g))
    if (match[1]) names.add(match[1]);
  return [...names];
}

export const SPACING_SCALE = ['0', '1', '2', '3', '4', '6', '8', '12'] as const; // 0–48px on the 4px grid
export const FONT_SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;
export const FONT_WEIGHTS = ['normal', 'medium', 'semibold', 'bold'] as const;

/** Every `--name: value;` declared in tokens.css. */
export function tokenValues(tokensCss: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const m of tokensCss.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g))
    if (m[1] && m[2]) values[m[1]] = m[2].trim();
  return values;
}

/** Colour values that are safe to render as a swatch (no url(), no var(), no expressions). */
export const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/;
