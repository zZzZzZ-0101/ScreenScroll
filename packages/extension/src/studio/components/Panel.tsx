import { FILTERS, PAPERS, type FilterId, type PaperId } from '@screenscroll/core';
import {
  ChevronRight,
  GripHorizontal,
  Info,
  MousePointerClick,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  X,
} from 'lucide-react';
import { useState } from 'react';
import {
  DEFAULT_PRESETS,
  MAX_PRESETS,
  labelName,
  type Presets,
  type Settings,
} from '@/shared/settings';
import type { ImageMode } from '@/studio/engine/compose';
import type { Edits } from '../App';

const field = 'flex items-center justify-between gap-2 py-1';
const control =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent dark:border-neutral-700 dark:bg-neutral-900';
export const button =
  'rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800';
const aside = 'h-full overflow-y-auto p-3';

interface PagesProps {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  filename: string;
  cropped: boolean;
  /** Pages of a document viewer found in the capture, or null. */
  sheetCount: number | null;
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
      {p.sheetCount !== null && (
        <div
          className="mb-2 rounded-md border border-accent/40 bg-accent/5 p-2"
          data-testid="sheets"
        >
          <p className="font-medium">{p.sheetCount} document pages found</p>
          <label className="flex items-center gap-2 pt-1 text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={p.settings.followSheets}
              onChange={(e) => p.onSettings({ followSheets: e.target.checked })}
              className="accent-[#0e7c7b]"
            />
            One PDF page per document page
          </label>
        </div>
      )}
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
          <button
            type="button"
            onClick={() => void chrome.runtime.openOptionsPage()}
            className="mt-2 text-accent underline-offset-2 hover:underline"
          >
            All settings, with defaults and recommendations
          </button>
        </div>
      )}
    </aside>
  );
}

interface BreaksProps {
  edits: Edits;
  onReset: () => void;
  /** Breaks follow a document's own pages. */
  locked: boolean;
}

/** Breaks mode: how to edit, and one way back to the automatic result. */
export function BreaksPanel(p: BreaksProps) {
  const edited = p.edits.pinned.length + p.edits.removed.length > 0;
  const tips: Array<[typeof Plus, string]> = [
    [GripHorizontal, 'Drag a line to move a break. Hold Alt to place it freely.'],
    [MousePointerClick, 'Double-click the page to add a break.'],
    [X, 'Point at a break and click × to remove it.'],
  ];
  if (p.locked)
    return (
      <aside className={aside} aria-label="Page breaks">
        <p className="text-neutral-600 dark:text-neutral-300">
          The breaks follow the document&apos;s own pages. To place them yourself, turn off
          &ldquo;One PDF page per document page&rdquo; in Pages.
        </p>
      </aside>
    );
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

/** PDF options (UI §3): text layer, links, bookmarks. */
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
      <p className="pt-1 text-[12px] text-neutral-500">
        Filter, page labels and watermark: Mark up → Page.
      </p>
    </div>
  );
}

/**
 * Mark up → Page → Filter: one line per filter (name, what it does); ⓘ opens what it is
 * for and the exact method and numbers. Applies to every page and every output.
 */
function FilterPicker({ value, onChange }: { value: FilterId; onChange: (f: FilterId) => void }) {
  const [open, setOpen] = useState<FilterId | null>(null);
  return (
    <fieldset className="min-w-0">
      <legend className="pb-1 font-semibold">Filter</legend>
      <div role="radiogroup" aria-label="Filter" className="flex flex-col">
        {FILTERS.map((f) => (
          <div
            key={f.id}
            className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
          >
            <div className="flex items-center gap-1">
              <label className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 py-1">
                <input
                  type="radio"
                  name="page-filter"
                  checked={value === f.id}
                  onChange={() => onChange(f.id)}
                  className="accent-[#0e7c7b]"
                />
                <span className="shrink-0 font-medium whitespace-nowrap">{f.name}</span>
                <span className="min-w-0 truncate text-[12px] text-neutral-500" title={f.short}>
                  {f.short}
                </span>
              </label>
              <button
                type="button"
                aria-expanded={open === f.id}
                aria-label={`About ${f.name}`}
                title={`About ${f.name}`}
                onClick={() => setOpen(open === f.id ? null : f.id)}
                className="rounded p-0.5 text-neutral-400 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-accent dark:hover:text-white"
              >
                <Info aria-hidden size={14} />
              </button>
            </div>
            {open === f.id && (
              <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-md bg-neutral-50 p-2 text-[12px] dark:bg-neutral-800/60">
                <dt className="text-neutral-500">What</dt>
                <dd>{f.details}</dd>
                <dt className="text-neutral-500">For</dt>
                <dd>{f.bestFor}</dd>
                <dt className="text-neutral-500">Not for</dt>
                <dd>{f.notFor}</dd>
                <dt className="text-neutral-500">Method</dt>
                <dd className="font-mono text-[11px] leading-snug">{f.params}</dd>
              </dl>
            )}
          </div>
        ))}
      </div>
      <p className="pt-1 text-[12px] text-neutral-500">
        Every page and output. Mark-up stays in colour.
      </p>
    </fieldset>
  );
}

/**
 * A row of presets: click one to use it (when `onUse` is given), × removes it, the save
 * buttons add a current value, "Restore defaults" brings back removed built-in ones.
 */
function PresetChips<T>({
  label,
  items,
  name,
  active = () => false,
  onUse,
  onChange,
  saves,
  defaults,
  same,
}: {
  label: string;
  items: T[];
  name: (t: T) => string;
  active?: (t: T) => boolean;
  onUse?: (t: T) => void;
  onChange: (items: T[]) => void;
  /** Save buttons: their label and what they add (null = nothing to save yet). */
  saves: Array<{ label: string; value: T | null }>;
  defaults: T[];
  same: (a: T, b: T) => boolean;
}) {
  const missing = defaults.filter((d) => !items.some((t) => same(t, d)));
  const chip = 'px-1.5 max-w-40 truncate';
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1 pt-1">
      {items.map((t, i) => (
        <span
          key={`${name(t)}-${i}`}
          className={`inline-flex items-center rounded border text-[12px] ${active(t) ? 'border-accent bg-accent/10' : 'border-neutral-300 dark:border-neutral-700'}`}
        >
          {onUse ? (
            <button
              type="button"
              onClick={() => onUse(t)}
              title={`Use “${name(t)}”`}
              className={`${chip} hover:bg-neutral-100 dark:hover:bg-neutral-800`}
            >
              {name(t)}
            </button>
          ) : (
            <span className={chip} title={name(t)}>
              {name(t)}
            </span>
          )}
          <button
            type="button"
            aria-label={`Remove preset ${name(t)}`}
            title="Remove this preset"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="border-l border-inherit px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white"
          >
            ×
          </button>
        </span>
      ))}
      {saves.map(({ label: l, value }) => {
        const dup = value !== null && items.some((t) => same(t, value));
        const full = items.length >= MAX_PRESETS;
        return (
          <button
            key={l}
            type="button"
            disabled={value === null || dup || full}
            onClick={() => value !== null && onChange([...items, value])}
            title={
              value === null
                ? 'Nothing to save yet'
                : dup
                  ? 'Already a preset'
                  : full
                    ? `At most ${MAX_PRESETS} presets`
                    : 'Keep this as a preset'
            }
            className="rounded border border-dashed border-neutral-400 px-1.5 text-[12px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {l}
          </button>
        );
      })}
      {missing.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...items, ...missing])}
          className="text-[12px] text-accent underline-offset-2 hover:underline"
        >
          Restore defaults ({missing.length})
        </button>
      )}
    </div>
  );
}

const WM_COLOURS: Array<[string, string]> = [
  ['#808080', 'Grey'],
  ['#d93025', 'Red'],
  ['#1a73e8', 'Blue'],
];

/**
 * Mark up → Page: what goes on every page, like a scanning app: labels at the top and bottom
 * (any text, with {date}, {page}…) and a watermark on every page or chosen pages.
 */
export function PageMarkPanel({
  settings,
  onSettings,
}: {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
}) {
  const pdf = settings.pdf;
  const wm = pdf.watermark;
  const setWm = (patch: Partial<typeof wm>) =>
    onSettings({ pdf: { ...pdf, watermark: { ...wm, ...patch } } });
  const mode = wm.pages === 'all' || wm.pages === 'first' ? wm.pages : 'some';
  const presets = settings.presets;
  const setPresets = (patch: Partial<Presets>) => onSettings({ presets: { ...presets, ...patch } });
  return (
    <aside className={aside} aria-label="Page">
      <FilterPicker
        value={pdf.filter}
        onChange={(filter) => onSettings({ pdf: { ...pdf, filter } })}
      />
      <h2 className="mt-3 border-t border-neutral-200 pt-3 font-semibold dark:border-neutral-700">
        Page labels
      </h2>
      <p className="pb-1 text-[12px] text-neutral-500">
        On every page, above and below the content.
      </p>
      {BANDS.map(([band, label]) => (
        <fieldset key={band} className="pt-1">
          <legend className="flex w-full items-center justify-between pb-1">
            {label}
            <select
              aria-label={`${label} preset`}
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'none')
                  onSettings({ pdf: { ...pdf, [band]: { left: '', center: '', right: '' } } });
                const preset = presets.labels[Number(v)];
                if (v !== '' && v !== 'none' && preset)
                  onSettings({ pdf: { ...pdf, [band]: preset.band } });
              }}
              className="rounded border border-neutral-300 bg-white px-1 text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">Presets…</option>
              {presets.labels.map((l, i) => (
                <option key={`${l.name}-${i}`} value={i}>
                  {l.name}
                </option>
              ))}
              <option value="none">None</option>
            </select>
          </legend>
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
      <p className="pt-1 text-[12px] text-neutral-500">
        {'{date} {time} {page} {pages} {title} {domain} {url}, or any text'}
      </p>
      <PresetChips
        label="Label presets"
        items={presets.labels}
        name={(l) => l.name}
        onChange={(labels) => setPresets({ labels })}
        saves={BANDS.map(([band, label]) => {
          const n = labelName(pdf[band]);
          return {
            label: `+ Save ${label.toLowerCase()}`,
            value: n ? { name: n, band: pdf[band] } : null,
          };
        })}
        defaults={DEFAULT_PRESETS.labels}
        same={(x, y) => labelName(x.band) === labelName(y.band)}
      />

      <h2 className="mt-4 border-t border-neutral-200 pt-3 font-semibold dark:border-neutral-800">
        Watermark
      </h2>
      <input
        aria-label="Watermark text"
        placeholder="Text, e.g. CONFIDENTIAL"
        className={`${control} mt-1 w-full`}
        value={wm.text}
        onChange={(e) => setWm({ text: e.target.value })}
      />
      <PresetChips
        label="Watermark presets"
        items={presets.watermarks}
        name={(t) => t}
        active={(t) => t === wm.text}
        onUse={(t) => setWm({ text: t })}
        onChange={(watermarks) => setPresets({ watermarks })}
        saves={[{ label: '+ Save', value: wm.text.trim() || null }]}
        defaults={DEFAULT_PRESETS.watermarks}
        same={(a, b) => a === b}
      />
      <label className={field}>
        Opacity
        <input
          type="range"
          min={0.05}
          max={0.6}
          step={0.05}
          value={wm.opacity}
          onChange={(e) => setWm({ opacity: Number(e.target.value) })}
          className="w-28 accent-[#0e7c7b]"
        />
      </label>
      <label className={field}>
        Size
        <input
          type="range"
          min={16}
          max={140}
          step={2}
          value={wm.sizePt}
          onChange={(e) => setWm({ sizePt: Number(e.target.value) })}
          className="w-28 accent-[#0e7c7b]"
        />
      </label>
      <div className={field}>
        <span id="wm-angle">Angle</span>
        <div role="radiogroup" aria-labelledby="wm-angle" className="flex gap-1">
          {[45, 0, -45].map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={wm.angle === a}
              onClick={() => setWm({ angle: a })}
              className={`${button} ${wm.angle === a ? 'border-accent bg-accent/10 text-accent' : ''}`}
            >
              {a}°
            </button>
          ))}
        </div>
      </div>
      <div className={field}>
        <span id="wm-colour">Colour</span>
        <div role="radiogroup" aria-labelledby="wm-colour" className="flex gap-1">
          {WM_COLOURS.map(([c, name]) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={wm.color === c}
              aria-label={name}
              onClick={() => setWm({ color: c })}
              className={`h-5 w-5 rounded-full border border-neutral-300 ${wm.color === c ? 'ring-2 ring-accent ring-offset-1' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <fieldset className="pt-1">
        <legend className="pb-1">Apply to</legend>
        {(
          [
            ['all', 'Every page'],
            ['first', 'First page only'],
            ['some', 'These pages:'],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 py-0.5">
            <input
              type="radio"
              name="wm-pages"
              checked={mode === v}
              onChange={() => setWm({ pages: v === 'some' ? '1' : v })}
              className="accent-[#0e7c7b]"
            />
            {label}
            {v === 'some' && mode === 'some' && (
              <input
                aria-label="Watermark pages"
                className={`${control} w-24`}
                value={wm.pages}
                placeholder="1-3, 5"
                onChange={(e) => setWm({ pages: e.target.value })}
              />
            )}
          </label>
        ))}
      </fieldset>
      {wm.text.trim() && (
        <button
          type="button"
          onClick={() => setWm({ text: '' })}
          className="mt-2 text-[12px] text-accent underline-offset-2 hover:underline"
        >
          Remove watermark
        </button>
      )}
      <p className="pt-2 text-[12px] text-neutral-500">Shown in Pages and in the saved PDF.</p>
    </aside>
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
