import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssetsPanel, LayersTree } from './layers-panel';

const NODES = [
  {
    line: 3,
    column: 4,
    tag: 'main',
    label: '',
    children: [
      { line: 4, column: 6, tag: 'h1', label: 'Welcome back', children: [] },
      { line: 8, column: 6, tag: 'button', label: 'Continue', children: [] },
    ],
  },
];

describe('LayersTree', () => {
  it('lists nested layers, marks the selected one and selects on click', async () => {
    const onSelect = vi.fn();
    render(
      <LayersTree
        screenName="Home"
        nodes={NODES}
        selected={{ line: 4, column: 6 }}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('region', { name: 'Layers of Home' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'h1 Welcome back, line 4' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'button Continue, line 8' }));
    expect(onSelect).toHaveBeenCalledWith(NODES[0]?.children[1]);
  });

  it('explains when no screen is selected or the screen is empty', () => {
    const { rerender } = render(
      <LayersTree screenName={null} nodes={undefined} selected={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('Select a screen to see its layers.')).toBeVisible();
    rerender(<LayersTree screenName="Home" nodes={[]} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText('No layers')).toBeVisible();
  });
});

describe('AssetsPanel', () => {
  it('groups tokens, shows only safe colour swatches and copies var() names', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = render(
      <AssetsPanel
        tokensCss={`:root { --color-primary: #0b5cff; --color-evil: url(https://x.test/a.png); --font-sans: Inter; --radius-md: 8px; --shadow-1: 0 1px 2px #0002; --gap: 4px; }`}
      />,
    );
    for (const title of ['Colours', 'Typography', 'Radius', 'Effects', 'Other'])
      expect(screen.getByRole('heading', { name: title })).toBeVisible();
    const swatches = Array.from(container.querySelectorAll<HTMLElement>('span[style]'));
    expect(swatches.map((s) => s.style.background)).toEqual(['rgb(11, 92, 255)']);
    await userEvent.click(screen.getByRole('button', { name: 'Copy --color-primary' }));
    expect(writeText).toHaveBeenCalledWith('var(--color-primary)');
    expect(await screen.findByText('Copied var(--color-primary)')).toBeVisible();
  });
});
