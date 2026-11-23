import type { LayerNode } from '@core-studio/contracts';
import { Copy, Layers } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '../../components/ui';
import { SAFE_COLOR, tokenValues } from './class-utils';

/** The selected screen's elements, nested as rendered; choosing one selects it on the canvas. */
export function LayersTree({
  screenName,
  nodes,
  selected,
  onSelect,
}: {
  screenName: string | null;
  nodes: LayerNode[] | undefined;
  selected: { line: number; column: number } | null;
  onSelect: (node: LayerNode) => void;
}) {
  if (!screenName)
    return <p className="px-2 text-sm text-text-muted">Select a screen to see its layers.</p>;
  if (!nodes) return <p className="px-2 text-sm text-text-muted">Loading layers…</p>;
  if (nodes.length === 0)
    return (
      <EmptyState icon={<Layers size={24} />} title="No layers">
        This screen has no elements yet.
      </EmptyState>
    );
  const render = (list: LayerNode[], depth: number) => (
    <ul className="space-y-px">
      {list.map((node, i) => {
        const active = selected?.line === node.line && selected.column === node.column;
        return (
          <li key={`${String(node.line)}:${String(node.column)}:${String(i)}`}>
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              aria-label={`${node.tag}${node.label ? ` ${node.label}` : ''}, line ${String(node.line)}`}
              className={`flex w-full min-w-0 items-center gap-2 rounded py-1 pr-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent ${active ? 'bg-accent/10 text-accent' : 'hover:bg-surface-muted'}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => {
                onSelect(node);
              }}
            >
              <span className="font-mono text-xs text-text-muted">{node.tag}</span>
              <span className="truncate">{node.label}</span>
            </button>
            {node.children.length > 0 && render(node.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );
  return (
    <section aria-label={`Layers of ${screenName}`} className="space-y-1">
      <h2 className="px-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
        Layers · {screenName}
      </h2>
      {render(nodes, 0)}
    </section>
  );
}

const GROUPS: { title: string; match: (name: string) => boolean }[] = [
  { title: 'Colours', match: (n) => n.startsWith('--color-') },
  { title: 'Typography', match: (n) => n.startsWith('--font-') },
  { title: 'Radius', match: (n) => n.startsWith('--radius') },
  { title: 'Effects', match: (n) => n.startsWith('--shadow') || n.startsWith('--focus') },
];

/** The file's design tokens, grouped; copying gives the Tailwind form agents and editors use. */
export function AssetsPanel({ tokensCss }: { tokensCss: string }) {
  const values = tokenValues(tokensCss);
  const names = Object.keys(values);
  const [copied, setCopied] = useState<string | null>(null);
  const groups = [
    ...GROUPS.map((g) => ({ title: g.title, names: names.filter(g.match) })),
    { title: 'Other', names: names.filter((n) => !GROUPS.some((g) => g.match(n))) },
  ].filter((g) => g.names.length > 0);
  if (names.length === 0)
    return <p className="px-2 text-sm text-text-muted">This file has no design tokens.</p>;
  return (
    <section aria-label="Assets" className="space-y-4">
      <p role="status" className="min-h-4 px-2 text-xs text-text-muted">
        {copied ? `Copied var(${copied})` : ''}
      </p>
      {groups.map((group) => (
        <div key={group.title} className="space-y-1">
          <h2 className="px-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
            {group.title}
          </h2>
          <ul>
            {group.names.map((name) => {
              const value = values[name] ?? '';
              return (
                <li key={name}>
                  <button
                    type="button"
                    aria-label={`Copy ${name}`}
                    title={value}
                    className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                    onClick={() => {
                      // The Clipboard API is missing on insecure origins: copying is a convenience.
                      void Promise.resolve()
                        .then(() => navigator.clipboard.writeText(`var(${name})`))
                        .catch(() => undefined);
                      setCopied(name);
                    }}
                  >
                    {SAFE_COLOR.test(value) ? (
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 rounded border border-border"
                        style={{ background: value }}
                      />
                    ) : (
                      <span aria-hidden="true" className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate font-mono text-xs">{name.replace(/^--/, '')}</span>
                    <span className="ml-auto truncate text-xs text-text-muted">{value}</span>
                    <Copy size={12} aria-hidden="true" className="shrink-0 text-text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
