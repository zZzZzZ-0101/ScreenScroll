import { TOOL_KEYS, type Style, type Tool } from '@screenscroll/core';
import {
  Circle,
  Crop,
  Droplets,
  Grid3x3,
  Hash,
  Highlighter,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';

const GROUPS: Array<Array<[Tool, string, typeof Square]>> = [
  [['select', 'Select', MousePointer2]],
  [
    ['arrow', 'Arrow', MoveUpRight],
    ['rect', 'Rectangle', Square],
    ['ellipse', 'Ellipse', Circle],
    ['line', 'Line', Minus],
  ],
  [
    ['pen', 'Pen', Pencil],
    ['highlighter', 'Highlighter', Highlighter],
    ['text', 'Text', Type],
    ['step', 'Step number', Hash],
  ],
  [
    ['blur', 'Blur', Droplets],
    ['pixelate', 'Pixelate', Grid3x3],
  ],
  [['crop', 'Crop', Crop]],
];

/** What each tool does, in one line, shown under the toolbar. */
const HINTS: Record<Tool, string> = {
  select: 'Click a mark to select it. Drag to move, Delete to remove, double-click text to edit.',
  arrow: 'Drag from the tail to the tip.',
  rect: 'Drag to draw a box.',
  ellipse: 'Drag to draw an ellipse.',
  line: 'Drag to draw a line.',
  pen: 'Drag to draw freehand.',
  highlighter: 'Drag over text to highlight it.',
  text: 'Click where the text goes, type, then press Enter. Shift+Enter adds a line.',
  step: 'Click to place the next number.',
  blur: 'Drag over anything private. Its text and links are also removed from the PDF.',
  pixelate: 'Drag over anything private. Its text and links are also removed from the PDF.',
  crop: 'Drag over the part to keep. Only that part is paginated and saved.',
};

export const SWATCHES = ['#d93025', '#f29900', '#188038', '#1a73e8', '#202124', '#ffffff'];
const SIZES: Array<[string, string, Pick<Style, 'width' | 'fontSize'>]> = [
  ['S', 'Small', { width: 2, fontSize: 14 }],
  ['M', 'Medium', { width: 3, fontSize: 18 }],
  ['L', 'Large', { width: 6, fontSize: 28 }],
];

const keyOf = Object.fromEntries(Object.entries(TOOL_KEYS).map(([k, t]) => [t, k.toUpperCase()]));
const iconBtn =
  'grid h-8 w-8 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40';

export interface MarkupControls {
  tool: Tool;
  onTool: (t: Tool) => void;
  style: Style;
  onStyle: (s: Style) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  selected: boolean;
  onDelete: () => void;
  count: number;
  onClear: () => void;
  cropped: boolean;
  onResetCrop: () => void;
}

/**
 * Mark up mode (UI §3 Annotate, distilled): every tool in one row, one size control for
 * stroke and text, and a sentence saying what the current tool does.
 */
export function MarkupToolbar(a: MarkupControls) {
  const size = SIZES.reduce((best, s) =>
    Math.abs(s[2].width - a.style.width) < Math.abs(best[2].width - a.style.width) ? s : best,
  )[0];
  return (
    <div className="border-b border-neutral-200 bg-white px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-1">
        <div role="toolbar" aria-label="Tools" className="flex flex-wrap items-center gap-0.5">
          {GROUPS.map((group, g) => (
            <div
              key={g}
              className="flex items-center gap-0.5 border-r border-neutral-200 pr-1 last:border-0 dark:border-neutral-700"
            >
              {group.map(([t, label, Icon]) => (
                <button
                  key={t}
                  type="button"
                  aria-label={label}
                  aria-pressed={a.tool === t}
                  title={`${label} (${keyOf[t]})`}
                  onClick={() => a.onTool(t)}
                  className={`${iconBtn} ${a.tool === t ? 'bg-accent text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                >
                  <Icon aria-hidden size={17} />
                </button>
              ))}
            </div>
          ))}
        </div>

        <div role="radiogroup" aria-label="Colour" className="ml-2 flex items-center gap-1">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={a.style.color === c}
              aria-label={c}
              title="Colour"
              onClick={() => a.onStyle({ ...a.style, color: c })}
              className={`h-5 w-5 rounded-full border border-neutral-300 focus-visible:outline-2 focus-visible:outline-accent dark:border-neutral-600 ${a.style.color === c ? 'ring-2 ring-accent ring-offset-1 dark:ring-offset-neutral-900' : ''}`}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom colour"
            title="Custom colour"
            value={a.style.color}
            onChange={(e) => a.onStyle({ ...a.style, color: e.target.value })}
            className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
          />
        </div>

        <div
          role="radiogroup"
          aria-label="Size"
          className="ml-2 flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700"
        >
          {SIZES.map(([short, label, s]) => (
            <button
              key={short}
              type="button"
              role="radio"
              aria-checked={size === short}
              aria-label={label}
              title={`${label} lines and text`}
              onClick={() => a.onStyle({ ...a.style, ...s })}
              className={`w-7 rounded py-0.5 focus-visible:outline-2 focus-visible:outline-accent ${size === short ? 'bg-neutral-200 font-medium dark:bg-neutral-700' : 'text-neutral-500'}`}
            >
              {short}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={!a.canUndo}
            onClick={a.onUndo}
            className={`${iconBtn} hover:bg-neutral-100 dark:hover:bg-neutral-800`}
          >
            <Undo2 aria-hidden size={17} />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
            disabled={!a.canRedo}
            onClick={a.onRedo}
            className={`${iconBtn} hover:bg-neutral-100 dark:hover:bg-neutral-800`}
          >
            <Redo2 aria-hidden size={17} />
          </button>
          <button
            type="button"
            aria-label="Delete"
            title="Delete selected (Del)"
            disabled={!a.selected}
            onClick={a.onDelete}
            className={`${iconBtn} hover:bg-neutral-100 dark:hover:bg-neutral-800`}
          >
            <Trash2 aria-hidden size={17} />
          </button>
        </div>
      </div>
      <p className="flex flex-wrap gap-x-3 pt-1 text-[12px] text-neutral-500" aria-live="polite">
        <span>{HINTS[a.tool]}</span>
        {a.selected && a.tool === 'select' && (
          <span>Colour and size apply to the selected mark.</span>
        )}
        {a.cropped && (
          <button
            type="button"
            className="text-accent underline-offset-2 hover:underline"
            onClick={a.onResetCrop}
          >
            Reset crop
          </button>
        )}
        {a.count > 0 && (
          <button type="button" className="underline-offset-2 hover:underline" onClick={a.onClear}>
            Clear all ({a.count})
          </button>
        )}
      </p>
    </div>
  );
}
