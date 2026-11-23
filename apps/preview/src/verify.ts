import {
  MAX_VERIFY_ISSUES,
  VERIFY_SEVERITIES,
  type VerifyIssue,
  type VerifySeverity,
} from '@core-studio/contracts';

/**
 * Verify checks for a rendered screen: axe-core (WCAG 2.2 AA) plus design-system checks on the
 * rendered DOM. Every finding is mapped back to the screen's source through `data-core-loc`.
 * Runs only when the studio asks; axe-core is bundled (the preview CSP allows no fetches).
 */

/** The source location of an element, or of its nearest located ancestor inside `root`. */
export function sourceLocation(
  el: Element | null,
  root: Element,
): { line: number; column: number } | null {
  for (let node = el; node && root.contains(node); node = node.parentElement) {
    const loc = node.getAttribute('data-core-loc');
    if (!loc) continue;
    const match = /^(\d+):(\d+)$/.exec(loc);
    if (!match) continue;
    const line = Number(match[1]);
    if (line < 1) continue;
    return { line, column: Number(match[2]) };
  }
  return null;
}

const clip = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function issue(
  root: Element,
  el: Element | null,
  fields: Omit<VerifyIssue, 'line' | 'column' | 'message' | 'help'> & {
    message: string;
    help: string;
  },
): VerifyIssue {
  const loc = sourceLocation(el, root);
  return {
    ...fields,
    message: clip(fields.message),
    help: clip(fields.help),
    ...(loc ? { line: loc.line, column: loc.column } : {}),
  };
}

// ---------- design-system checks ----------

const COLOR_UTILITIES =
  'bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|placeholder|caret|accent|shadow|inset-shadow';
/** A literal colour value: hex, a colour function, or white/black. */
const COLOR_LITERAL =
  /(^|[^\w-])(#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(|white\b|black\b)/i;
/** `bg-[#123456]`, `text-[rgb(0_0_0)]`, `hover:border-x-[#fff]/50`, `[color:#123]`. */
const ARBITRARY_COLOR = new RegExp(
  `^(?:[^:\\s]+:)*!?(?:(?:${COLOR_UTILITIES})-\\[([^\\]]+)\\]|\\[(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke|outline-color):([^\\]]+)\\])(?:/\\S+)?$`,
);
const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe';
/** Tailwind's own palette (`bg-blue-500`, `text-white`): a fixed colour, not a design token. */
const PALETTE_COLOR = new RegExp(
  `^(?:[^:\\s]+:)*!?(?:${COLOR_UTILITIES})-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|white|black)(?:/\\S+)?$`,
);
const STYLE_COLOR_PROPERTY =
  /^(?:color|background(?:-color|-image)?|border(?:-[a-z]+)*-color|border(?:-(?:top|right|bottom|left))?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color)$/;

/** Hard-coded colours in an element's classes. */
export function hardCodedColorClasses(className: string): {
  arbitrary: string[];
  palette: string[];
} {
  const arbitrary: string[] = [];
  const palette: string[] = [];
  for (const cls of className.split(/\s+/)) {
    if (!cls) continue;
    const m = ARBITRARY_COLOR.exec(cls);
    if (m) {
      const value = (m[1] ?? m[2] ?? '').replace(/_/g, ' ');
      if (!value.includes('var(') && COLOR_LITERAL.test(value)) arbitrary.push(cls);
      continue;
    }
    if (PALETTE_COLOR.test(cls)) palette.push(cls);
  }
  return { arbitrary, palette };
}

/** Inline-style declarations that set a literal colour (not a `var(--…)` token). */
export function hardCodedStyleColors(style: string): string[] {
  const found: string[] = [];
  for (const declaration of style.split(';')) {
    const at = declaration.indexOf(':');
    if (at < 0) continue;
    const property = declaration.slice(0, at).trim().toLowerCase();
    const value = declaration.slice(at + 1).trim();
    if (!STYLE_COLOR_PROPERTY.test(property) || value.includes('var(')) continue;
    if (COLOR_LITERAL.test(value)) found.push(`${property}: ${value}`);
  }
  return found;
}

const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[data-link]',
  '[tabindex]:not([tabindex="-1"])',
  ...['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option'].map(
    (role) => `[role="${role}"]`,
  ),
].join(',');

const MIN_TARGET = 24;
const MIN_FONT_PX = 12;

const hasOwnText = (el: Element) =>
  Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
  );

function isHidden(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden')) return true;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
}

/** A link inside a sentence is exempt from the target-size minimum (WCAG 2.5.8 "inline"). */
const isInlineLink = (el: Element) =>
  el.tagName === 'A' &&
  !!el.parentElement &&
  Array.from(el.parentElement.childNodes).some(
    (n) => n !== el && n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
  );

/** Design-system checks on the rendered DOM under `root`. */
export function designSystemChecks(root: Element): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const elements = Array.from(root.querySelectorAll('*'));
  const interactive = new Set(root.querySelectorAll(INTERACTIVE));

  for (const el of elements) {
    const { arbitrary, palette } = hardCodedColorClasses(el.getAttribute('class') ?? '');
    if (arbitrary.length > 0)
      issues.push(
        issue(root, el, {
          id: 'ds-hardcoded-color',
          severity: 'moderate',
          category: 'design-system',
          message: `Hard-coded colour ${arbitrary.join(', ')} on <${el.tagName.toLowerCase()}>.`,
          help: 'Use a design-token colour such as bg-[var(--color-surface)] so the screen follows the design system and theme.',
        }),
      );
    if (palette.length > 0)
      issues.push(
        issue(root, el, {
          id: 'ds-palette-color',
          severity: 'minor',
          category: 'design-system',
          message: `Tailwind palette colour ${palette.join(', ')} on <${el.tagName.toLowerCase()}>.`,
          help: 'Palette colours are fixed values. Use a design-token colour such as text-[var(--color-text)] instead.',
        }),
      );
    const inline = hardCodedStyleColors(el.getAttribute('style') ?? '');
    if (inline.length > 0)
      issues.push(
        issue(root, el, {
          id: 'ds-inline-color',
          severity: 'moderate',
          category: 'design-system',
          message: `Inline style sets a hard-coded colour (${inline.join('; ')}).`,
          help: 'Set colours with design tokens, e.g. color: var(--color-text), or a token class.',
        }),
      );

    if (hasOwnText(el) && !isHidden(el)) {
      const fontSize = getComputedStyle(el).fontSize;
      // Browsers resolve font sizes to px; anything else (jsdom keywords, em) cannot be judged.
      const size = fontSize.endsWith('px') ? Number.parseFloat(fontSize) : Number.NaN;
      if (Number.isFinite(size) && size > 0 && size < MIN_FONT_PX)
        issues.push(
          issue(root, el, {
            id: 'ds-text-size',
            severity: 'moderate',
            category: 'design-system',
            message: `Text is ${String(Math.round(size * 10) / 10)}px, below the ${String(MIN_FONT_PX)}px minimum.`,
            help: 'Use text-xs (12px) or larger so text stays readable.',
          }),
        );
    }

    if (interactive.has(el) && !isInlineLink(el) && !isHidden(el)) {
      const rect = el.getBoundingClientRect();
      // Nothing to judge for an element that is not laid out.
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        (rect.width < MIN_TARGET || rect.height < MIN_TARGET)
      )
        issues.push(
          issue(root, el, {
            id: 'ds-target-size',
            severity: 'serious',
            category: 'design-system',
            message: `Touch target is ${String(Math.round(rect.width))}×${String(Math.round(rect.height))}px, smaller than ${String(MIN_TARGET)}×${String(MIN_TARGET)}px.`,
            help: 'Give interactive elements at least 24×24px (WCAG 2.5.8), e.g. with min-h-6 min-w-6 or padding.',
          }),
        );
    }

    if (
      (el.tagName === 'IMG' && !el.hasAttribute('alt')) ||
      (el.getAttribute('role') === 'img' &&
        !el.hasAttribute('aria-label') &&
        !el.hasAttribute('aria-labelledby'))
    )
      issues.push(
        issue(root, el, {
          id: 'ds-image-alt',
          severity: 'critical',
          category: 'design-system',
          message: 'Image has no text alternative.',
          help: 'Add alt text that says what the image shows, or alt="" when it is decorative.',
        }),
      );
  }
  return issues;
}

// ---------- axe-core ----------

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Rules about the whole document, which belongs to the preview runtime, not to the screen. */
const AXE_DISABLED = [
  'document-title',
  'html-has-lang',
  'html-lang-valid',
  'html-xml-lang-mismatch',
];

/** The subset of axe-core's results that the checks use. */
export interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { element?: Element | null; failureSummary?: string }[];
}

export function axeIssues(root: Element, violations: AxeViolation[]): VerifyIssue[] {
  return violations.flatMap((violation) =>
    violation.nodes.map((node) =>
      issue(root, node.element ?? null, {
        id: violation.id.slice(0, 80),
        severity: (VERIFY_SEVERITIES as readonly string[]).includes(violation.impact ?? '')
          ? (violation.impact as VerifySeverity)
          : 'moderate',
        category: 'accessibility',
        message: (node.failureSummary ?? violation.help).replace(/\s+/g, ' ').trim(),
        help: violation.help,
      }),
    ),
  );
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs axe-core on `root`. Runs are serialised: axe refuses to run twice at once. */
export function runAxe(root: Element): Promise<VerifyIssue[]> {
  const run = queue.then(async () => {
    const { default: axe } = await import('axe-core');
    const results = await axe.run(root, {
      runOnly: { type: 'tag', values: AXE_TAGS },
      rules: Object.fromEntries(AXE_DISABLED.map((id) => [id, { enabled: false }])),
      resultTypes: ['violations'],
      elementRef: true,
    });
    return axeIssues(
      root,
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        help: v.help,
        nodes: v.nodes.map((n) => ({
          element: n.element ?? null,
          ...(n.failureSummary ? { failureSummary: n.failureSummary } : {}),
        })),
      })),
    );
  });
  queue = run.catch(() => undefined);
  return run;
}

// ---------- merging ----------

/** Rules that report the same problem; axe's finding wins over the design-system one. */
const SAME_PROBLEM: Record<string, string> = {
  'image-alt': 'image-alt',
  'role-img-alt': 'image-alt',
  'svg-img-alt': 'image-alt',
  'ds-image-alt': 'image-alt',
  'target-size': 'target-size',
  'ds-target-size': 'target-size',
};

/** Accessibility first, de-duplicated, ordered by severity, capped at MAX_VERIFY_ISSUES. */
export function mergeIssues(accessibility: VerifyIssue[], design: VerifyIssue[]): VerifyIssue[] {
  const seen = new Set<string>();
  const merged: VerifyIssue[] = [];
  for (const item of [...accessibility, ...design]) {
    const key = `${SAME_PROBLEM[item.id] ?? item.id}@${String(item.line ?? '')}:${String(item.column ?? '')}:${SAME_PROBLEM[item.id] ? '' : item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  const rank = (s: VerifySeverity) => VERIFY_SEVERITIES.indexOf(s);
  return merged
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.severity) - rank(b.item.severity) || a.index - b.index)
    .map(({ item }) => item)
    .slice(0, MAX_VERIFY_ISSUES);
}

/** Every check on the rendered screen under `root`. */
export async function verifyScreen(
  root: Element,
  axe: (root: Element) => Promise<VerifyIssue[]> = runAxe,
): Promise<VerifyIssue[]> {
  const accessibility = await axe(root);
  return mergeIssues(accessibility, designSystemChecks(root));
}
