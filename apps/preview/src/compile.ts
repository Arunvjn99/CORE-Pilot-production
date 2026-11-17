import { transform } from '@babel/standalone';
import type { PluginObj, types as t } from '@babel/core';

/**
 * Compiles one screen (TSX, default-exported component) to a CommonJS function body. A small Babel
 * plugin tags every intrinsic JSX element with `data-core-loc="line:column"` from the ORIGINAL source,
 * which is exactly what the API's source-edit engine looks up (same parser family, same positions).
 */
function locPlugin({ types }: { types: typeof t }): PluginObj {
  return {
    name: 'core-loc',
    visitor: {
      JSXOpeningElement(path) {
        const { node } = path;
        if (node.name.type !== 'JSXIdentifier' || !/^[a-z]/.test(node.name.name) || !node.loc)
          return;
        if (
          node.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === 'data-core-loc')
        )
          return;
        node.attributes.push(
          types.jsxAttribute(
            types.jsxIdentifier('data-core-loc'),
            types.stringLiteral(`${String(node.loc.start.line)}:${String(node.loc.start.column)}`),
          ),
        );
      },
    },
  };
}

export function compileScreen(code: string, filename: string): string {
  const result = transform(code, {
    filename,
    sourceType: 'module',
    presets: [
      ['react', { runtime: 'classic' }],
      ['typescript', { isTSX: true, allExtensions: true }],
    ],
    plugins: [locPlugin, 'transform-modules-commonjs'],
  });
  if (!result.code) throw new Error('Compilation produced no output');
  return result.code;
}
