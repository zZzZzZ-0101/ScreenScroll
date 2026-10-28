import { PAPERS, type PaperId } from '@screenscroll/core';
import {
  ChevronRight,
  GripHorizontal,
  MousePointerClick,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { Settings } from '@/shared/settings';
import type { ImageMode } from '@/studio/engine/compose';
import type { Edits } from '../App';

const field = 'flex items-center justify-between gap-2 py-1';
const control =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent dark:border-neutral-700 dark:bg-neutral-900';
export const button =
  'rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800';
const aside =
  'w-64 shrink-0 overflow-y-auto border-l border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900';

interface PagesProps {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  filename: string;
  cropped: boolean;
  /** Estimated PDF size in bytes, or null while it is computed. */
  estimate: number | null;
}

/**
 * Pages mode (UI §3, distilled): the three choices that change what the pages look like,
 * with everything else folded under "More options".
 */
export function PagesPanel(p: PagesProps) {
  const page = p.settings.page;
  const paperId = typeof page.paper === 'string' ? page.paper : 'custom';
  const margin = page.marginsMm.top;
  const [more, setMore] = useState(() => readFlag('sp-more-options'));

  return (
    <aside className={aside} aria-label="Page setup">
      <label className={field}>
        Paper
        <select
          className={control}
          value={paperId}
          onChange={(e) => p.onSettings({ page: { ...page, paper: e.target.value as PaperId } })}
        >
          {Object.keys(PAPERS).map((id) => (
            <option key={id}>{id}</option>
          ))}
          {paperId === 'custom' && <option value="custom">Custom</option>}
        </select>
      </label>
      <div className={field}>
        <span id="orient">Orientation</span>
        <div role="radiogroup" aria-labelledby="orient" className="flex gap-1">
          {(
            [
              ['portrait', 'Portrait', RectangleVertical],
              ['landscape', 'Landscape', RectangleHorizontal],
            ] as const
          ).map(([o, label, Icon]) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={page.orientation === o}
              aria-label={label}
              title={label}
              onClick={() => p.onSettings({ page: { ...page, orientation: o } })}
              className={`${button} ${page.orientation === o ? 'border-accent bg-accent/10 text-accent' : ''}`}
            >
              <Icon aria-hidden size={16} />
            </button>
          ))}
        </div>
      </div>
      <div className="py-2">
        <label htmlFor="style" className="block pb-1">
          Page breaks
        </label>
        <input
          id="style"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={p.settings.breakStyle}
          onChange={(e) => p.onSettings({ breakStyle: Number(e.target.value) })}
          className="w-full accent-[#0e7c7b]"
          aria-valuetext={
            p.settings.breakStyle < 0.35
              ? 'Fewer pages'
              : p.settings.breakStyle > 0.65
                ? 'Cleaner breaks'
                : 'Balanced'
          }
        />
        <div className="flex justify-between text-[12px] text-neutral-500">
          <span>Fewer pages</span>
          <span>Cleaner breaks</span>
        </div>
      </div>

      <p className="py-1 text-neutral-500" data-testid="estimate">
        {p.estimate === null
          ? 'PDF size: estimating'
          : `PDF size: about ${formatBytes(p.estimate)}`}
      </p>

      <button
        type="button"
        aria-expanded={more}
        onClick={() => {
          setMore(!more);
          writeFlag('sp-more-options', !more);
        }}
        className="mt-2 flex w-full items-center gap-1 border-t border-neutral-200 pt-2 text-left font-medium focus-visible:outline-2 focus-visible:outline-accent dark:border-neutral-800"
      >
        <ChevronRight
          aria-hidden
          size={14}
          className={`transition-transform ${more ? 'rotate-90' : ''}`}
        />
        More options
      </button>
      {more && (
        <div className="pt-1">
          <label className={field}>
            Margins (mm)
            <input
              type="number"
              min={0}
              max={40}
              className={`${control} w-20`}
              value={margin}
              onChange={(e) => {
                const v = Math.max(0, Math.min(40, Number(e.target.value) || 0));
                p.onSettings({
                  page: { ...page, marginsMm: { top: v, right: v, bottom: v, left: v } },
                });
              }}
            />
          </label>
          <label className={field}>
            Crop sides
            <select
              className={control}
              value={p.settings.crop}
              onChange={(e) => p.onSettings({ crop: e.target.value as 'auto' | 'off' })}
            >
              <option value="auto">Auto</option>
              <option value="off">Off</option>
            </select>
          </label>
          {p.settings.crop === 'auto' && (
            <p className="pb-1 text-[12px] text-neutral-500">
              {p.cropped ? 'Empty side margins are cropped.' : 'No wide margins to crop.'}
            </p>
          )}
          <label className={field}>
            Images
            <select
              className={control}
              value={p.settings.imageMode}
              onChange={(e) => p.onSettings({ imageMode: e.target.value as ImageMode })}
            >
              <option value="auto">Auto</option>
              <option value="png">Sharp (PNG)</option>
              <option value="jpeg">Smaller file (JPEG)</option>
            </select>
          </label>
          <PdfOptions settings={p.settings} onSettings={p.onSettings} />
          <label className="block py-1">
            File name
            <input
              className={`${control} mt-1 w-full`}
              value={p.settings.filenameTemplate}
              onChange={(e) => p.onSettings({ filenameTemplate: e.target.value })}
              aria-describedby="fname"
            />
          </label>
          <p id="fname" className="break-all text-[12px] text-neutral-500">
            {p.filename}
          </p>
          <p className="pt-1 text-[12px] text-neutral-500">
            {'{title} {domain} {date} {time} {url}'}
          </p>
        </div>
      )}
    </aside>
  );
}

interface BreaksProps {
  edits: Edits;
  onReset: () => void;
}

/** Breaks mode: how to edit, and one way back to the automatic result. */
export function BreaksPanel(p: BreaksProps) {
  const edited = p.edits.pinned.length + p.edits.removed.length > 0;
  const tips: Array<[typeof Plus, string]> = [
    [GripHorizontal, 'Drag a line to move a break. Hold Alt to place it freely.'],
    [MousePointerClick, 'Double-click the page to add a break.'],
    [X, 'Point at a break and click × to remove it.'],
  ];
  return (
    <aside className={aside} aria-label="Page breaks">
      <ul className="space-y-2 pb-3">
        {tips.map(([Icon, text]) => (
          <li key={text} className="flex gap-2 text-neutral-600 dark:text-neutral-300">
            <Icon aria-hidden size={16} className="mt-0.5 shrink-0 text-accent" />
            {text}
          </li>
        ))}
      </ul>
      <button type="button" className={`${button} w-full`} onClick={p.onReset} disabled={!edited}>
        Reset breaks
      </button>
      <p className="pt-1 text-[12px] text-neutral-500">
        {edited
          ? `${p.edits.pinned.length} added or moved, ${p.edits.removed.length} removed.`
          : 'All breaks are automatic.'}
      </p>
    </aside>
  );
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const BANDS: Array<['header' | 'footer', string]> = [
  ['header', 'Header'],
  ['footer', 'Footer'],
];

/** PDF options (UI §3): text layer, links, bookmarks, header and footer. */
function PdfOptions({ settings, onSettings }: Pick<PagesProps, 'settings' | 'onSettings'>) {
  const pdf = settings.pdf;
  const toggles: Array<['textLayer' | 'links' | 'outline', string]> = [
    ['textLayer', 'Searchable text'],
    ['links', 'Clickable links'],
    ['outline', 'Bookmarks from headings'],
  ];
  return (
    <div className="py-1">
      {toggles.map(([key, label]) => (
        <label key={key} className="flex items-center gap-2 py-0.5">
          <input
            type="checkbox"
            checked={pdf[key]}
            onChange={(e) => onSettings({ pdf: { ...pdf, [key]: e.target.checked } })}
            className="accent-[#0e7c7b]"
          />
          {label}
        </label>
      ))}
      {BANDS.map(([band, label]) => (
        <fieldset key={band} className="pt-2">
          <legend className="pb-1">{label}</legend>
          <div className="grid grid-cols-3 gap-1">
            {(['left', 'center', 'right'] as const).map((slot) => (
              <input
                key={slot}
                aria-label={`${label} ${slot}`}
                placeholder={slot}
                className={`${control} min-w-0`}
                value={pdf[band][slot]}
                onChange={(e) =>
                  onSettings({ pdf: { ...pdf, [band]: { ...pdf[band], [slot]: e.target.value } } })
                }
              />
            ))}
          </div>
        </fieldset>
      ))}
      <p className="pt-1 text-[12px] text-neutral-500">{'{page} {pages} {title} {date}'}</p>
    </div>
  );
}

// Per-viewer UI memory only; storage may be unavailable, and that's fine.
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* not essential */
  }
}
