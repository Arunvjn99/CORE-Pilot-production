import { Hand, MessageCircle, MousePointer2, Sparkles, SquarePlus } from 'lucide-react';
import { useEffect, useRef } from 'react';

export type Tool = 'move' | 'hand' | 'comment';

export interface ToolbarActions {
  setTool: (tool: Tool) => void;
  addScreen: () => void;
  askAi: () => void;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  togglePanels: () => void;
  clearSelection: () => void;
  undo: () => void;
  redo: () => void;
}

/** True when the key press belongs to a text field, menu or dialog rather than the canvas. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]') !== null);

/**
 * Figma-style shortcuts: V move, H hand (or hold Space), S add screen, C comment, / ask AI,
 * Shift+1 fit, ⌘/Ctrl + / − zoom, ⌘/Ctrl Z undo, ⌘/Ctrl Shift Z (or Y) redo, ⌘/Ctrl + \ hide panels, Esc clears the selection.
 * Keys pressed inside a screen's iframe stay in the screen (different origin).
 */
export function useEditorShortcuts(actions: ToolbarActions, tool: Tool, canWrite: boolean) {
  const latest = useRef({ actions, tool, canWrite });
  useEffect(() => {
    latest.current = { actions, tool, canWrite };
  });
  useEffect(() => {
    let spaceFrom: Tool | null = null;
    const down = (event: KeyboardEvent) => {
      if (typing(event.target)) return;
      const { actions: a, tool: current, canWrite: write } = latest.current;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key;
      let handled = true;
      if (mod && (key === 'z' || key === 'Z') && event.shiftKey) a.redo();
      else if (mod && (key === 'z' || key === 'Z')) a.undo();
      else if (mod && (key === 'y' || key === 'Y')) a.redo();
      else if (mod && (key === '=' || key === '+')) a.zoomIn();
      else if (mod && key === '-') a.zoomOut();
      else if (mod && key === '\\') a.togglePanels();
      else if (mod || event.altKey) handled = false;
      else if (event.shiftKey && (key === '!' || event.code === 'Digit1')) a.fit();
      else if (key === ' ' && !event.repeat && current !== 'hand') {
        spaceFrom = current;
        a.setTool('hand');
      } else if (key === 'v' || key === 'V') a.setTool('move');
      else if (key === 'h' || key === 'H') a.setTool('hand');
      else if ((key === 'c' || key === 'C') && write) a.setTool('comment');
      else if ((key === 's' || key === 'S') && write) a.addScreen();
      else if (key === '/') a.askAi();
      else if (key === 'Escape') a.clearSelection();
      else handled = false;
      if (handled) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === ' ' && spaceFrom) {
        // Otherwise releasing Space would also "click" a focused toolbar button.
        event.preventDefault();
        latest.current.actions.setTool(spaceFrom);
        spaceFrom = null;
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
}

const button =
  'flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-accent-contrast disabled:opacity-40';

/** Floating toolbar at the bottom of the canvas (Figma UI3). */
export function CanvasToolbar({
  tool,
  canWrite,
  actions,
}: {
  tool: Tool;
  canWrite: boolean;
  actions: ToolbarActions;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-lg"
    >
      <button
        type="button"
        className={button}
        aria-label="Move (V)"
        title="Move (V)"
        aria-pressed={tool === 'move'}
        onClick={() => {
          actions.setTool('move');
        }}
      >
        <MousePointer2 size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={button}
        aria-label="Hand (H)"
        title="Hand (H, or hold Space)"
        aria-pressed={tool === 'hand'}
        onClick={() => {
          actions.setTool('hand');
        }}
      >
        <Hand size={18} aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-border" />
      <button
        type="button"
        className={button}
        aria-label="Add screen (S)"
        title="Add screen (S)"
        disabled={!canWrite}
        onClick={actions.addScreen}
      >
        <SquarePlus size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={button}
        aria-label="Comment (C)"
        title="Comment (C)"
        aria-pressed={tool === 'comment'}
        disabled={!canWrite}
        onClick={() => {
          actions.setTool(tool === 'comment' ? 'move' : 'comment');
        }}
      >
        <MessageCircle size={18} aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-border" />
      <button
        type="button"
        className={button}
        aria-label="Ask the AI agents (/)"
        title="Ask the AI agents (/)"
        onClick={actions.askAi}
      >
        <Sparkles size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
