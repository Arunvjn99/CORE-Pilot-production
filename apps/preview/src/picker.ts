import type { SelectedElement } from '@core-studio/contracts';

const ATTRIBUTES = ['data-link', 'alt', 'placeholder', 'aria-label', 'title'] as const;

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
