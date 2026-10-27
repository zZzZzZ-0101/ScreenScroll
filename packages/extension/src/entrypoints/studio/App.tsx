import {
  buildFilename,
  computeLayout,
  contentCrop,
  medianFontPx,
  paginateDebug,
  readabilityAdvice,
  sliderWeights,
  type PageLayout,
  type PaginationDebug,
} from '@scrollpress/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadSettings, saveSettings, type Settings } from '@/lib/settings';
import { analyze, type Analysis } from '@/lib/studio/analysis';
import {
  copyPageImage,
  download,
  exportLongImage,
  exportLongPagePdf,
  exportPageImagesZip,
  exportPdf,
  ext,
  openPdfForPrint,
  zipBlobs,
} from '@/lib/studio/export';
import { FrameCache, loadSession, type LoadedSession } from '@/lib/studio/session';
import { composePage, encodePage } from '@/lib/studio/compose';
import { Panel, type ExportFormat } from './Panel';
import { PagesView } from './PagesView';
import { StripView } from './StripView';
import { Thumbnails } from './Thumbnails';
import { exportDebugOverlay } from './debug-export';

type Stage =
  | { kind: 'loading' }
  | { kind: 'analysing'; done: number; total: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

type PageResult =
  | { ok: false; error: string }
  | {
      ok: true;
      crop: { x0: number; x1: number; cropped: boolean };
      layout: PageLayout;
      debug: PaginationDebug;
    };

export interface Edits {
  pinned: number[];
  removed: number[];
}

const params = new URLSearchParams(location.search);
const SESSION_ID = params.get('session') ?? '';
const AUTO = params.get('auto'); // 'pdf' = UI §1 "Save PDF directly"

export function App() {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [session, setSession] = useState<LoadedSession | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [edits, setEdits] = useState<Edits>({ pinned: [], removed: [] });
  const [view, setView] = useState<'pages' | 'strip'>('pages');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const frames = useRef<FrameCache | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, st] = await Promise.all([loadSession(SESSION_ID), loadSettings()]);
        if (cancelled) return;
        document.title = `${s.session.title || 'Capture'} · ScrollPress`;
        frames.current = new FrameCache(s.frames);
        setSession(s);
        setSettings(st);
        const a = await analyze(s, frames.current, (done, total) =>
          setStage({ kind: 'analysing', done, total }),
        );
        if (cancelled) return;
        setAnalysis(a);
        setStage({ kind: 'ready' });
      } catch (e) {
        setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const result = useMemo((): PageResult | null => {
    if (!session || !analysis || !settings) return null;
    const crop =
      settings.crop === 'auto'
        ? contentCrop(session.width, { rows: analysis.rows, hints: session.hints })
        : { x0: 0, x1: session.width, cropped: false };
    let layout: PageLayout;
    try {
      layout = computeLayout(settings.page, crop.x1 - crop.x0);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const debug: PaginationDebug = paginateDebug({
      height: session.height,
      width: session.width,
      T: layout.T,
      hints: session.hints,
      rows: analysis.rows,
      crop,
      options: { ...sliderWeights(settings.breakStyle), ...edits },
    });
    return { ok: true, crop, layout, debug };
  }, [session, analysis, settings, edits]);

  const slices = result && result.ok ? result.debug.slices : [];

  const warnings = useMemo(() => {
    if (!session || !result || !result.ok) return [];
    const list = [...session.session.warnings];
    const advice = readabilityAdvice(
      medianFontPx(session.hints.textRuns.map((t) => t.fontSizePx)),
      result.layout.s,
    );
    if (advice) list.push(advice);
    if (result.layout.scaleClamped)
      list.push('The fixed scale was reduced so the page fits the paper width.');
    for (const s of result.debug.slices) list.push(...s.warnings);
    if (session.session.status === 'cancelled')
      list.unshift('Capture was cancelled; this is what was captured.');
    if (session.session.status === 'error')
      list.unshift('Capture stopped early; this is what was captured.');
    return list;
  }, [session, result]);

  // Export tab "estimated file size" (UI §3): encode the first and a middle page, extrapolate.
  const [estimate, setEstimate] = useState<number | null>(null);
  useEffect(() => {
    if (!session || !result?.ok || !settings || !frames.current) return;
    const f = frames.current;
    let cancelled = false;
    setEstimate(null);
    const t = setTimeout(async () => {
      const sample = [...new Set([0, Math.floor(slices.length / 2)])].filter((i) => slices[i]);
      let bytes = 0;
      for (const i of sample) {
        const img = await encodePage(
          await composePage(session, f, slices[i]!),
          slices[i]!,
          settings.imageMode,
        );
        bytes += img.bytes.length;
      }
      if (!cancelled && sample.length) setEstimate((bytes / sample.length) * slices.length);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [session, result, settings, slices]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await saveSettings(patch));
  }, []);

  const filename = useCallback(
    (extension: string) =>
      session && settings
        ? buildFilename(
            settings.filenameTemplate,
            {
              title: session.session.title,
              url: session.session.url,
              date: new Date(session.session.capturedAt),
            },
            extension,
          )
        : `capture.${extension}`,
    [session, settings],
  );

  const run = useCallback(
    async (
      label: string,
      job: (progress: (d: number, t: number) => void) => Promise<string | void>,
    ) => {
      setBusy(label);
      try {
        const done = await job((d, t) => setBusy(`${label} ${d}/${t}`));
        if (done) setToast(done);
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const doExport = useCallback(
    async (format: ExportFormat) => {
      if (!session || !result || !result.ok || !settings || !frames.current) return;
      const f = frames.current;
      const { layout, crop } = result;
      await run('Exporting', async (progress) => {
        switch (format) {
          case 'pdf': {
            const bytes = await exportPdf(session, f, slices, layout, settings.imageMode, progress);
            await download(bytes, filename('pdf'), 'application/pdf');
            return `Saved ${filename('pdf')}`;
          }
          case 'pdf-long': {
            const bytes = await exportLongPagePdf(
              session,
              f,
              slices,
              layout,
              settings.imageMode,
              progress,
            );
            await download(bytes, filename('pdf'), 'application/pdf');
            return `Saved ${filename('pdf')}`;
          }
          case 'png':
          case 'jpeg':
          case 'webp': {
            const base = filename('zip').replace(/\.zip$/, '');
            const bytes = await exportPageImagesZip(session, f, slices, format, base, progress);
            await download(bytes, filename('zip'), 'application/zip');
            return `Saved ${filename('zip')}`;
          }
          case 'long-png': {
            const parts = await exportLongImage(session, f, crop, 'png', progress);
            if (parts.length === 1) {
              await download(parts[0]!, filename('png'), 'image/png');
              return `Saved ${filename('png')}`;
            }
            const base = filename('png').replace(/\.png$/, '');
            const zip = zipBlobs(
              await Promise.all(
                parts.map(async (p, i) => ({
                  name: `${base}-part${i + 1}.${ext('png')}`,
                  bytes: new Uint8Array(await p.arrayBuffer()),
                })),
              ),
            );
            await download(zip, filename('zip'), 'application/zip');
            return `The image was too tall for one file; saved ${parts.length} parts in ${filename('zip')}`;
          }
        }
      });
    },
    [session, result, settings, slices, filename, run],
  );

  const doPrint = useCallback(async () => {
    if (!session || !result || !result.ok || !settings || !frames.current) return;
    const f = frames.current;
    await run('Preparing PDF', async (progress) => {
      openPdfForPrint(
        await exportPdf(session, f, slices, result.layout, settings.imageMode, progress),
      );
    });
  }, [session, result, settings, slices, run]);

  const doCopy = useCallback(async () => {
    if (!session || !frames.current || !slices[page]) return;
    const f = frames.current;
    await run('Copying', async () => {
      await copyPageImage(session, f, slices[page]!);
      return `Page ${page + 1} copied as an image`;
    });
  }, [session, slices, page, run]);

  const doDebug = useCallback(async () => {
    if (!session || !analysis || !result || !result.ok) return;
    await run('Exporting overlay', async () => {
      const { png, json } = await exportDebugOverlay(analysis, result.debug, session.width);
      await download(png, filename('png').replace(/\.png$/, '-breaks.png'), 'image/png');
      await download(
        new Blob([json], { type: 'application/json' }),
        filename('json').replace(/\.json$/, '-breaks.json'),
        'application/json',
      );
      return 'Saved break overlay (PNG and JSON)';
    });
  }, [session, analysis, result, filename, run]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // UI §1 fast path: save the PDF with automatic breaks, then close this tab.
  const autoDone = useRef(false);
  useEffect(() => {
    if (AUTO !== 'pdf' || autoDone.current || stage.kind !== 'ready' || !result || !result.ok)
      return;
    autoDone.current = true;
    void doExport('pdf').then(() => setTimeout(() => window.close(), 500));
  }, [stage, result, doExport]);

  // Keyboard (UI §3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void doExport('pdf');
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void doCopy();
      } else if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void doPrint();
      } else if (e.key === 'ArrowRight') setPage((p) => Math.min(slices.length - 1, p + 1));
      else if (e.key === 'ArrowLeft') setPage((p) => Math.max(0, p - 1));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [doExport, doCopy, doPrint, slices.length]);

  // e2e hook (stripped from production builds).
  useEffect(() => {
    if (!__SP_E2E__ || !session || !result || !result.ok || !settings || !frames.current) return;
    const f = frames.current;
    Object.assign(window, {
      __spStudio: {
        slices: () => result.debug.slices,
        layout: () => result.layout,
        crop: () => result.crop,
        warnings: () => warnings,
        async pdfBase64() {
          const bytes = await exportPdf(
            session,
            f,
            result.debug.slices,
            result.layout,
            settings.imageMode,
          );
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000)
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(bin);
        },
      },
    });
  }, [session, result, settings, warnings]);

  if (stage.kind === 'error') {
    return (
      <Centered>
        <p role="alert" className="text-red-700 dark:text-red-300">
          {stage.message}
        </p>
      </Centered>
    );
  }
  if (!session || !analysis || !settings || !result) {
    const text =
      stage.kind === 'analysing'
        ? `Reading the capture ${stage.done}/${stage.total}`
        : 'Loading capture';
    return (
      <Centered>
        <p aria-live="polite">{text}</p>
      </Centered>
    );
  }

  const domain = (() => {
    try {
      return new URL(session.session.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const captured = new Date(session.session.capturedAt).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex h-screen flex-col text-[13px] text-neutral-900 dark:text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold" title={session.session.title}>
            {session.session.title || 'Untitled capture'}
          </h1>
          <p className="truncate text-neutral-500">
            {domain} · {captured} · {result.ok ? `${slices.length} pages` : ''}
          </p>
        </div>
        {warnings.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowWarnings((v) => !v)}
              aria-expanded={showWarnings}
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 focus-visible:outline-2 focus-visible:outline-accent dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
            >
              ⚠ {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
            </button>
            {showWarnings && (
              <ul
                data-testid="warnings"
                className="absolute right-0 z-20 mt-1 w-96 rounded-md border border-neutral-200 bg-white p-2 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {warnings.map((w, i) => {
                  const m = /^Page (\d+):/.exec(w);
                  return (
                    <li key={i} className="py-1">
                      {m ? (
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => {
                            setPage(Number(m[1]) - 1);
                            setShowWarnings(false);
                          }}
                        >
                          {w}
                        </button>
                      ) : (
                        w
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void doExport('pdf')}
          disabled={!!busy || !result.ok}
          title="Save PDF (Ctrl+S)"
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          Save PDF
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {result.ok ? (
          <>
            <Thumbnails analysis={analysis} slices={slices} page={page} onSelect={setPage} />
            <main className="flex min-w-0 flex-1 flex-col">
              <div
                role="tablist"
                aria-label="View"
                className="flex gap-1 border-b border-neutral-200 bg-white px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900"
              >
                {(['pages', 'strip'] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    type="button"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={`rounded-md px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent ${view === v ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                  >
                    {v === 'pages' ? 'Pages' : 'Long strip'}
                  </button>
                ))}
              </div>
              {view === 'pages' ? (
                <PagesView
                  session={session}
                  frames={frames.current!}
                  analysis={analysis}
                  slices={slices}
                  layout={result.layout}
                  page={page}
                  onSelect={setPage}
                />
              ) : (
                <StripView
                  session={session}
                  frames={frames.current!}
                  analysis={analysis}
                  debug={result.debug}
                  crop={result.crop}
                  edits={edits}
                  onEdits={setEdits}
                  page={page}
                />
              )}
            </main>
          </>
        ) : (
          <main className="flex flex-1 items-center justify-center p-6">
            <p role="alert">{result.error}</p>
          </main>
        )}
        <Panel
          settings={settings}
          onSettings={updateSettings}
          edits={edits}
          onRerun={() => setEdits({ pinned: [], removed: [] })}
          filename={filename}
          busy={busy}
          onExport={doExport}
          onCopy={doCopy}
          onPrint={doPrint}
          onDebug={doDebug}
          cropped={result.ok && result.crop.cropped}
          estimate={estimate}
        />
      </div>

      {(busy || toast) && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-neutral-900 px-3 py-2 text-white shadow-sm dark:bg-neutral-100 dark:text-neutral-900"
          onClick={() => setToast(null)}
        >
          {busy ?? toast}
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center text-[13px] text-neutral-700 dark:text-neutral-300">
      {children}
    </div>
  );
}
