import { type LayerNode, MAX_LAYERS, type SelectedElement } from '@core-studio/contracts';

const ATTRIBUTES = [
  'data-link',
  'data-trigger',
  'data-delay',
  'data-transition',
  'alt',
  'placeholder',
  'aria-label',
  'title',
] as const;

/** What the studio needs to show and edit the element; never includes page data beyond the element. */
export function describeElement(el: Element, path: string): SelectedElement {
  const [line = 1, column = 0] = (el.getAttribute('data-core-loc') ?? '1:0').split(':').map(Number);
  const leafText = el.children.length === 0 ? el.textContent : null;
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const name of ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value !== null) attributes[name] = value.slice(0, 500);
  }
  return {
    path,
    line: line > 0 ? line : 1,
    column: column >= 0 ? column : 0,
    tag: el.tagName.toLowerCase().slice(0, 40),
    className: (el.getAttribute('class') ?? '').slice(0, 2000),
    text: leafText === null ? null : leafText.slice(0, 2000),
    attributes,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    computed: {
      display: style.display.slice(0, 40),
      fontSize: style.fontSize.slice(0, 20),
      fontWeight: style.fontWeight.slice(0, 10),
      color: style.color.slice(0, 60),
      backgroundColor: style.backgroundColor.slice(0, 60),
    },
  };
}

const ownText = (el: Element) =>
  Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A short, human name for a layer: its own text, else a describing attribute. */
function layerLabel(el: Element, hasLayers: boolean): string {
  // A leaf layer is named by all its text (e.g. a button's <span>); a container only by its own.
  const text = hasLayers ? ownText(el) : el.textContent.replace(/\s+/g, ' ').trim();
  const fallback =
    el.getAttribute('aria-label') ??
    el.getAttribute('alt') ??
    el.getAttribute('placeholder') ??
    el.getAttribute('data-link') ??
    '';
  return (text || fallback).slice(0, 60);
}

/**
 * The screen's elements that come from its source (`data-core-loc`), nested as rendered. Elements
 * without a location (inside components or text-only wrappers) are skipped and their children lifted.
 * Capped at MAX_LAYERS nodes.
 */
export function buildLayerTree(root: Element): LayerNode[] {
  let count = 0;
  const walk = (parent: Element): LayerNode[] => {
    const nodes: LayerNode[] = [];
    for (const child of Array.from(parent.children)) {
      if (count >= MAX_LAYERS) break;
      const loc = child.getAttribute('data-core-loc');
      if (!loc) {
        nodes.push(...walk(child));
        continue;
      }
      const [line = 1, column = 0] = loc.split(':').map(Number);
      count += 1;
      const children = walk(child);
      nodes.push({
        line: line > 0 ? line : 1,
        column: column >= 0 ? column : 0,
        tag: child.tagName.toLowerCase().slice(0, 40),
        label: layerLabel(child, children.length > 0),
        children,
      });
    }
    return nodes.slice(0, 500);
  };
  return walk(root);
}
