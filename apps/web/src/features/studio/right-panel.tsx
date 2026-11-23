import type { Screen, SelectedElement, SourceEdit } from '@core-studio/contracts';
import { Play, Workflow } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { type ReactNode, useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import {
  type ClassGroup,
  colorTokens,
  FONT_SIZES,
  FONT_WEIGHTS,
  groupValue,
  setGroup,
  SPACING_SCALE,
} from './class-utils';
import { DesignSystemCard } from './design-system-card';
import { errorText } from './chat-panel';
import type { SourceChange } from './edit-history';
import { useRuns, useSourceEdit } from './studio-api';

const tab =
  'flex-1 border-b-2 border-transparent px-2 py-2 text-xs font-medium text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent data-[state=active]:border-accent data-[state=active]:text-text';
const control =
  'w-full rounded border border-border bg-surface px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border px-3 py-3">
      <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <label htmlFor={id} className="text-xs text-text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** A select bound to one Tailwind class group; empty option removes the group. */
function GroupSelect({
  label,
  className,
  group,
  options,
  onChange,
  disabled,
}: {
  label: string;
  className: string;
  group: ClassGroup;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const current = groupValue(className, group) ?? '';
  const known = options.some((o) => o.value === current);
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          className={control}
          value={current}
          disabled={disabled}
          onChange={(event) => {
            onChange(setGroup(className, group, event.target.value || null));
          }}
        >
          <option value="">—</option>
          {!known && current && <option value={current}>{current}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

const spacing = (prefix: string) =>
  SPACING_SCALE.map((s) => ({ value: `${prefix}-${s}`, label: `${String(Number(s) * 4)}px` }));
const tokenOptions = (prefix: string, tokens: string[]) =>
  tokens.map((t) => ({ value: `${prefix}-[var(${t})]`, label: t.replace('--color-', '') }));

function ElementInspector({
  element,
  tokensCss,
  onEdit,
  pending,
}: {
  element: SelectedElement;
  tokensCss: string;
  onEdit: (op: SourceEdit['op']) => void;
  pending: boolean;
}) {
  const [text, setText] = useState(element.text ?? '');
  const [raw, setRaw] = useState(element.className);
  const colors = colorTokens(tokensCss);
  const cls = element.className;
  const setClass = (next: string) => {
    onEdit({ type: 'setClassName', className: next });
  };
  const textId = useId();
  const rawId = useId();

  return (
    <>
      <Section title={`<${element.tag}>`}>
        <p className="text-xs text-text-muted">
          Line {element.line} · {Math.round(element.rect.width)}×{Math.round(element.rect.height)}
        </p>
        {element.text !== null && (
          <div className="space-y-1">
            <label htmlFor={textId} className="text-xs text-text-muted">
              Text
            </label>
            <textarea
              id={textId}
              rows={2}
              className={control}
              value={text}
              disabled={pending}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onBlur={() => {
                if (text !== element.text) onEdit({ type: 'setText', text });
              }}
            />
          </div>
        )}
      </Section>
      <Section title="Layout">
        <GroupSelect
          label="Display"
          className={cls}
          group="display"
          disabled={pending}
          onChange={setClass}
          options={['block', 'flex', 'inline-flex', 'grid', 'hidden'].map((v) => ({
            value: v,
            label: v,
          }))}
        />
        <GroupSelect
          label="Direction"
          className={cls}
          group="direction"
          disabled={pending}
          onChange={setClass}
          options={[
            { value: 'flex-row', label: 'Horizontal' },
            { value: 'flex-col', label: 'Vertical' },
          ]}
        />
        <GroupSelect
          label="Align"
          className={cls}
          group="align"
          disabled={pending}
          onChange={setClass}
          options={['start', 'center', 'end', 'stretch', 'baseline'].map((v) => ({
            value: `items-${v}`,
            label: v,
          }))}
        />
        <GroupSelect
          label="Justify"
          className={cls}
          group="justify"
          disabled={pending}
          onChange={setClass}
          options={['start', 'center', 'end', 'between', 'around'].map((v) => ({
            value: `justify-${v}`,
            label: v,
          }))}
        />
        <GroupSelect
          label="Gap"
          className={cls}
          group="gap"
          disabled={pending}
          onChange={setClass}
          options={spacing('gap')}
        />
      </Section>
      <Section title="Spacing">
        <GroupSelect
          label="Padding"
          className={cls}
          group="padding"
          disabled={pending}
          onChange={setClass}
          options={spacing('p')}
        />
        <GroupSelect
          label="Padding X"
          className={cls}
          group="paddingX"
          disabled={pending}
          onChange={setClass}
          options={spacing('px')}
        />
        <GroupSelect
          label="Padding Y"
          className={cls}
          group="paddingY"
          disabled={pending}
          onChange={setClass}
          options={spacing('py')}
        />
      </Section>
      <Section title="Size">
        <GroupSelect
          label="Width"
          className={cls}
          group="width"
          disabled={pending}
          onChange={setClass}
          options={[
            { value: 'w-full', label: 'Fill' },
            { value: 'w-auto', label: 'Hug' },
            { value: 'w-fit', label: 'Fit content' },
            { value: 'max-w-md', label: 'Max 448px' },
            { value: 'max-w-3xl', label: 'Max 768px' },
          ]}
        />
        <GroupSelect
          label="Height"
          className={cls}
          group="height"
          disabled={pending}
          onChange={setClass}
          options={[
            { value: 'h-full', label: 'Fill' },
            { value: 'h-auto', label: 'Hug' },
            { value: 'min-h-screen', label: 'Screen' },
          ]}
        />
      </Section>
      <Section title="Typography">
        <GroupSelect
          label="Size"
          className={cls}
          group="fontSize"
          disabled={pending}
          onChange={setClass}
          options={FONT_SIZES.map((v) => ({ value: `text-${v}`, label: v }))}
        />
        <GroupSelect
          label="Weight"
          className={cls}
          group="fontWeight"
          disabled={pending}
          onChange={setClass}
          options={FONT_WEIGHTS.map((v) => ({ value: `font-${v}`, label: v }))}
        />
        <GroupSelect
          label="Align"
          className={cls}
          group="textAlign"
          disabled={pending}
          onChange={setClass}
          options={['left', 'center', 'right'].map((v) => ({ value: `text-${v}`, label: v }))}
        />
        <GroupSelect
          label="Colour"
          className={cls}
          group="textColor"
          disabled={pending}
          onChange={setClass}
          options={tokenOptions('text', colors)}
        />
      </Section>
      <Section title="Fill, border and effects">
        <GroupSelect
          label="Fill"
          className={cls}
          group="background"
          disabled={pending}
          onChange={setClass}
          options={tokenOptions('bg', colors)}
        />
        <GroupSelect
          label="Border"
          className={cls}
          group="border"
          disabled={pending}
          onChange={setClass}
          options={[
            { value: 'border', label: '1px' },
            { value: 'border-2', label: '2px' },
          ]}
        />
        <GroupSelect
          label="Border colour"
          className={cls}
          group="borderColor"
          disabled={pending}
          onChange={setClass}
          options={tokenOptions('border', colors)}
        />
        <GroupSelect
          label="Radius"
          className={cls}
          group="radius"
          disabled={pending}
          onChange={setClass}
          options={['sm', 'md', 'lg']
            .map((v) => ({ value: `rounded-[var(--radius-${v})]`, label: v }))
            .concat({ value: 'rounded-full', label: 'full' })}
        />
        <GroupSelect
          label="Shadow"
          className={cls}
          group="shadow"
          disabled={pending}
          onChange={setClass}
          options={['1', '2', '3'].map((v) => ({
            value: `shadow-[var(--shadow-${v})]`,
            label: `Elevation ${v}`,
          }))}
        />
        <GroupSelect
          label="Opacity"
          className={cls}
          group="opacity"
          disabled={pending}
          onChange={setClass}
          options={['100', '75', '50', '25'].map((v) => ({
            value: `opacity-${v}`,
            label: `${v}%`,
          }))}
        />
      </Section>
      <Section title="Classes">
        <label htmlFor={rawId} className="sr-only">
          All classes
        </label>
        <textarea
          id={rawId}
          rows={3}
          spellCheck={false}
          className={`${control} font-mono`}
          value={raw}
          disabled={pending}
          onChange={(event) => {
            setRaw(event.target.value);
          }}
          onBlur={() => {
            if (raw !== element.className) setClass(raw);
          }}
        />
      </Section>
    </>
  );
}

function PrototypeLink({
  element,
  screens,
  onEdit,
  pending,
}: {
  element: SelectedElement;
  screens: Screen[];
  onEdit: (op: SourceEdit['op']) => void;
  pending: boolean;
}) {
  const current = element.attributes['data-link'] ?? '';
  return (
    <Section title="Interaction">
      <Field label="On click">
        {(id) => (
          <select
            id={id}
            className={control}
            value={current}
            disabled={pending}
            onChange={(event) => {
              onEdit({
                type: 'setAttribute',
                name: 'data-link',
                value: event.target.value || null,
              });
            }}
          >
            <option value="">No action</option>
            {screens.map((s) => (
              <option key={s.pageId} value={s.route}>
                Navigate to {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>
    </Section>
  );
}

export function RightPanel({
  projectId,
  teamId,
  selection,
  tokensCss,
  screens,
  revision,
  canWrite,
  onPlay,
  onEdited,
}: {
  projectId: string;
  teamId: string;
  selection: SelectedElement | null;
  tokensCss: string;
  screens: Screen[];
  revision: number;
  canWrite: boolean;
  onPlay: () => void;
  /** Called after a successful edit with the screen's source before and after (for undo). */
  onEdited: (change: SourceChange) => void;
}) {
  const edit = useSourceEdit(projectId);
  const runs = useRuns(projectId);
  const latest = runs.data?.[0];
  const apply = (op: SourceEdit['op']) => {
    if (!selection) return;
    edit.mutate(
      {
        path: selection.path,
        line: selection.line,
        column: selection.column,
        baseRevision: revision,
        op,
      },
      {
        onSuccess: (result) => {
          const screen = screens.find((s) => s.filePath === selection.path);
          if (screen)
            onEdited({
              pageId: screen.pageId,
              path: screen.filePath,
              before: screen.code,
              after: result.code,
            });
        },
      },
    );
  };
  const disabled = !canWrite || edit.isPending;
  const links = screens.flatMap((s) =>
    [...s.code.matchAll(/data-link="([^"]+)"/g)].map((m) => ({
      from: s.name,
      to: screens.find((x) => x.route === m[1])?.name ?? m[1] ?? '',
    })),
  );

  return (
    <Tabs.Root defaultValue="design" className="flex h-full flex-col">
      <Tabs.List aria-label="Inspector" className="flex border-b border-border">
        <Tabs.Trigger value="design" className={tab}>
          Design
        </Tabs.Trigger>
        <Tabs.Trigger value="prototype" className={tab}>
          Prototype
        </Tabs.Trigger>
        <Tabs.Trigger value="verify" className={tab}>
          Verify
        </Tabs.Trigger>
      </Tabs.List>
      {edit.error && (
        <div className="p-3">
          <ErrorMessage>
            {edit.error instanceof ApiError ? edit.error.message : 'The change could not be saved.'}
          </ErrorMessage>
        </div>
      )}
      <Tabs.Content value="design" className="flex-1 overflow-y-auto">
        {selection ? (
          <ElementInspector
            key={`${selection.path}:${String(selection.line)}:${String(selection.column)}:${selection.className}:${selection.text ?? ''}`}
            element={selection}
            tokensCss={tokensCss}
            onEdit={apply}
            pending={disabled}
          />
        ) : (
          <>
            <Section title="Selection">
              <p className="text-xs text-text-muted">
                Click an element in a screen to edit its text, layout, spacing, typography, fill,
                border and effects.
              </p>
            </Section>
            <DesignSystemCard projectId={projectId} teamId={teamId} canWrite={canWrite} />
          </>
        )}
      </Tabs.Content>
      <Tabs.Content value="prototype" className="flex-1 overflow-y-auto">
        {selection ? (
          <PrototypeLink element={selection} screens={screens} onEdit={apply} pending={disabled} />
        ) : (
          <Section title="Interaction">
            <p className="text-xs text-text-muted">
              Select a button or link to choose which screen it opens.
            </p>
          </Section>
        )}
        <Section title="Flow">
          {links.length === 0 ? (
            <p className="text-xs text-text-muted">No links between screens yet.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {links.map((l, i) => (
                <li key={`${l.from}-${String(i)}`} className="flex items-center gap-1">
                  <Workflow size={12} aria-hidden="true" className="text-text-muted" /> {l.from} →{' '}
                  {l.to}
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="primary"
            className="w-full justify-center"
            onClick={onPlay}
            disabled={screens.length === 0}
          >
            <Play size={14} aria-hidden="true" /> Play prototype
          </Button>
        </Section>
      </Tabs.Content>
      <Tabs.Content value="verify" className="flex-1 overflow-y-auto">
        <Section title="Latest run">
          {!latest ? (
            <p className="text-xs text-text-muted">No design runs yet.</p>
          ) : (
            <dl className="grid grid-cols-[6rem_1fr] gap-1 text-xs">
              <dt className="text-text-muted">Status</dt>
              <dd>
                {latest.status === 'failed'
                  ? (errorText(latest.errorCode) ?? 'Failed')
                  : latest.status}
              </dd>
              <dt className="text-text-muted">Review score</dt>
              <dd>{latest.reviewScore ?? '—'}</dd>
              <dt className="text-text-muted">Screens</dt>
              <dd>{latest.screens}</dd>
              <dt className="text-text-muted">Tokens</dt>
              <dd>{(latest.inputTokens + latest.outputTokens).toLocaleString()}</dd>
              <dt className="text-text-muted">LangSmith</dt>
              <dd>{latest.traced ? 'Traced' : 'Not traced'}</dd>
            </dl>
          )}
        </Section>
      </Tabs.Content>
    </Tabs.Root>
  );
}
