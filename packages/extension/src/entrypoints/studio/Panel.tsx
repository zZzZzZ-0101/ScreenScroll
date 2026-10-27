import { PAPERS, type PaperId } from '@scrollpress/core';
import { useState } from 'react';
import type { Settings } from '@/lib/settings';
import type { ImageMode } from '@/lib/studio/compose';
import type { Edits } from './App';

export type ExportFormat = 'pdf' | 'pdf-long' | 'png' | 'jpeg' | 'webp' | 'long-png';

const FORMATS: Array<[ExportFormat, string]> = [
  ['pdf', 'PDF, multiple pages'],
  ['pdf-long', 'PDF, one long page'],
  ['png', 'PNG per page (zip)'],
  ['jpeg', 'JPEG per page (zip)'],
  ['webp', 'WebP per page (zip)'],
  ['long-png', 'One long PNG'],
];

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  edits: Edits;
  onRerun: () => void;
  filename: (ext: string) => string;
  busy: string | null;
  onExport: (f: ExportFormat) => void;
  onCopy: () => void;
  onPrint: () => void;
  onDebug: () => void;
  cropped: boolean;
  /** Estimated PDF size in bytes, or null while it is computed. */
  estimate: number | null;
}

const field = 'flex items-center justify-between gap-2 py-1';
const control =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent dark:border-neutral-700 dark:bg-neutral-900';
const button =
  'rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800';

export function Panel(p: Props) {
  const [tab, setTab] = useState<'pages' | 'export'>('pages');
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const page = p.settings.page;
  const paperId = typeof page.paper === 'string' ? page.paper : 'custom';
  const margin = page.marginsMm.top;
  const edited = p.edits.pinned.length + p.edits.removed.length > 0;

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div role="tablist" aria-label="Panel" className="mb-3 flex gap-1">
        {(['pages', 'export'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent ${tab === t ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
          >
            {t === 'pages' ? 'Pages' : 'Export'}
          </button>
        ))}
      </div>

      {tab === 'pages' ? (
        <div>
          <label className={field}>
            Paper
            <select
              className={control}
              value={paperId}
              onChange={(e) =>
                p.onSettings({ page: { ...page, paper: e.target.value as PaperId } })
              }
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
              {(['portrait', 'landscape'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={page.orientation === o}
                  onClick={() => p.onSettings({ page: { ...page, orientation: o } })}
                  className={`${button} ${page.orientation === o ? 'bg-neutral-200 dark:bg-neutral-800' : ''}`}
                >
                  {o === 'portrait' ? 'Portrait' : 'Landscape'}
                </button>
              ))}
            </div>
          </div>
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
            <p className="pb-1 text-neutral-500">
              {p.cropped ? 'Empty side margins are cropped.' : 'No wide margins to crop.'}
            </p>
          )}
          <div className="py-2">
            <label htmlFor="style" className="block pb-1">
              Break style
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
            />
            <div className="flex justify-between text-neutral-500">
              <span>Fewer pages</span>
              <span>Cleaner breaks</span>
            </div>
          </div>
          <button
            type="button"
            className={`${button} w-full`}
            onClick={p.onRerun}
            disabled={!edited}
          >
            Re-run smart breaks
          </button>
          {edited && (
            <p className="pt-1 text-neutral-500">
              {p.edits.pinned.length} added or moved, {p.edits.removed.length} removed. Re-running
              clears your edits.
            </p>
          )}
        </div>
      ) : (
        <div>
          <label className={field}>
            Format
            <select
              className={control}
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              {FORMATS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {(format === 'pdf' || format === 'pdf-long') && (
            <p className="pb-1 text-neutral-500" data-testid="estimate">
              {p.estimate === null
                ? 'Estimating size'
                : `Estimated size: ${formatBytes(p.estimate)}`}
            </p>
          )}
          {(format === 'pdf' || format === 'pdf-long') && (
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
          )}
          <label className="block py-1">
            File name
            <input
              className={`${control} mt-1 w-full`}
              value={p.settings.filenameTemplate}
              onChange={(e) => p.onSettings({ filenameTemplate: e.target.value })}
              aria-describedby="fname"
            />
          </label>
          <p id="fname" className="break-all pb-2 text-neutral-500">
            {p.filename(format.startsWith('pdf') ? 'pdf' : format === 'long-png' ? 'png' : 'zip')}
          </p>
          <button
            type="button"
            disabled={!!p.busy}
            onClick={() => p.onExport(format)}
            title="Save (Ctrl+S saves the multi-page PDF)"
            className="w-full rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            Save
          </button>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button
              type="button"
              className={button}
              onClick={p.onCopy}
              disabled={!!p.busy}
              title="Copy this page (Ctrl+Shift+C)"
            >
              Copy page
            </button>
            <button
              type="button"
              className={button}
              onClick={p.onPrint}
              disabled={!!p.busy}
              title="Print (Ctrl+P)"
            >
              Print
            </button>
          </div>
          <button
            type="button"
            className={`${button} mt-3 w-full`}
            onClick={p.onDebug}
            disabled={!!p.busy}
          >
            Save break overlay (debug)
          </button>
        </div>
      )}
    </aside>
  );
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `≈ ${Math.max(1, Math.round(n / 1024))} KB`;
  return `≈ ${(n / 1024 / 1024).toFixed(1)} MB`;
}
