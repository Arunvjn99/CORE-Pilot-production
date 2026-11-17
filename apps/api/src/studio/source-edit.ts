import { parse } from '@babel/parser';
import type { JSXAttribute, JSXElement, Node } from '@babel/types';
import type { SourceEdit } from '@core-studio/contracts';

/**
 * Deterministic source edits (no LLM): find the JSX element whose opening tag starts at the given
 * line/column — the location the preview runtime injected from the same source — and splice the
 * change into the original text. Untouched code keeps its exact formatting.
 */
export class SourceEditError extends Error {
  constructor(
    readonly code: 'PARSE_FAILED' | 'ELEMENT_NOT_FOUND' | 'UNSUPPORTED',
    message: string,
  ) {
    super(message);
    this.name = 'SourceEditError';
  }
}

const PARSE_OPTIONS = { sourceType: 'module', plugins: ['jsx', 'typescript'] } as const;
const MAX_SOURCE = 512 * 1024;

export function parseTsx(code: string) {
  if (code.length > MAX_SOURCE) throw new SourceEditError('UNSUPPORTED', 'File too large to edit');
  try {
    return parse(code, {
      ...PARSE_OPTIONS,
      plugins: [...PARSE_OPTIONS.plugins],
      errorRecovery: false,
    });
  } catch {
    throw new SourceEditError('PARSE_FAILED', 'The file is not valid TSX');
  }
}

/** True when the code parses as TSX and has a default export (the screen contract). */
export function isValidScreen(code: string): boolean {
  try {
    const ast = parseTsx(code);
    return ast.program.body.some((n) => n.type === 'ExportDefaultDeclaration');
  } catch {
    return false;
  }
}

function findElement(node: Node, line: number, column: number): JSXElement | null {
  const stack: Node[] = [node];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current || ++visited > 200_000) break;
    if (
      current.type === 'JSXElement' &&
      current.openingElement.loc?.start.line === line &&
      current.openingElement.loc.start.column === column
    )
      return current;
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) {
        for (const child of value as unknown[])
          if (child && typeof child === 'object' && 'type' in child) stack.push(child as Node);
      } else if (
        value &&
        typeof value === 'object' &&
        'type' in value &&
        typeof (value as Node).type === 'string'
      ) {
        stack.push(value as Node);
      }
    }
  }
  return null;
}

function attribute(element: JSXElement, name: string): JSXAttribute | undefined {
  return element.openingElement.attributes.find(
    (a): a is JSXAttribute =>
      a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === name,
  );
}

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function setAttr(code: string, element: JSXElement, name: string, value: string | null): string {
  const existing = attribute(element, name);
  if (existing) {
    if (existing.start == null || existing.end == null)
      throw new SourceEditError('UNSUPPORTED', 'Unknown location');
    if (existing.value && existing.value.type !== 'StringLiteral')
      throw new SourceEditError(
        'UNSUPPORTED',
        `${name} is computed in code; edit it in the code view`,
      );
    const replacement = value === null ? '' : `${name}="${escapeAttr(value)}"`;
    const start =
      value === null && code[existing.start - 1] === ' ' ? existing.start - 1 : existing.start;
    return code.slice(0, start) + replacement + code.slice(existing.end);
  }
  if (value === null) return code;
  const tagName = element.openingElement.name;
  if (tagName.end == null) throw new SourceEditError('UNSUPPORTED', 'Unknown location');
  return `${code.slice(0, tagName.end)} ${name}="${escapeAttr(value)}"${code.slice(tagName.end)}`;
}

function setText(code: string, element: JSXElement, text: string): string {
  const children = element.children;
  const editable = children.every(
    (c) =>
      c.type === 'JSXText' ||
      (c.type === 'JSXExpressionContainer' && c.expression.type === 'StringLiteral'),
  );
  if (!editable || element.openingElement.selfClosing)
    throw new SourceEditError(
      'UNSUPPORTED',
      'This element contains other elements; select the text element itself',
    );
  const open = element.openingElement.end;
  const close = element.closingElement?.start;
  if (open == null || close == null) throw new SourceEditError('UNSUPPORTED', 'Unknown location');
  const literal = /[{}<>]/.test(text) || text !== text.trim() ? `{${JSON.stringify(text)}}` : text;
  return code.slice(0, open) + literal + code.slice(close);
}

export function applySourceEdit(
  code: string,
  edit: Pick<SourceEdit, 'line' | 'column' | 'op'>,
): string {
  const element = findElement(parseTsx(code), edit.line, edit.column);
  if (!element)
    throw new SourceEditError(
      'ELEMENT_NOT_FOUND',
      'The selected element is no longer in the source',
    );
  let next: string;
  switch (edit.op.type) {
    case 'setText':
      next = setText(code, element, edit.op.text);
      break;
    case 'setClassName':
      next = setAttr(code, element, 'className', edit.op.className.trim() || null);
      break;
    case 'setAttribute':
      next = setAttr(code, element, edit.op.name, edit.op.value);
      break;
  }
  parseTsx(next); // the result must still be valid TSX
  return next;
}
