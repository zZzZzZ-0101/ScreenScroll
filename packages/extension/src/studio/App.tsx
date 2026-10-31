import {
  buildFilename,
  commit,
  DEFAULT_STYLE,
  redactions,
  emptyHistory,
  exportScale,
  QUALITY,
  redo,
  TOOL_KEYS,
  undo,
  medianFontPx,
  readabilityAdvice,
  type Annotation,
  type History,
  type Region,
  type Style,
  type Tool,
} from '@screenscroll/core';
import {
  FileText,
  Info,
  Monitor,
  Moon,
  PenLine,
  SeparatorHorizontal,
  Sun,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_PROJECT, saveProject, type Project } from '@/shared/db';
import { OVERLAY_WARNING } from '@/shared/messages';
import { RedactCard } from './components/RedactCard';
import { loadSettings, saveSettings, type Settings } from '@/shared/settings';
import { analyze, type Analysis } from '@/studio/engine/analysis';
import { planPages, type Edits, type PageResult } from '@/studio/engine/plan';
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
} from '@/studio/engine/export';
import { FrameCache, loadSession, type LoadedSession } from '@/studio/engine/session';
import { composePage, encodePage } from '@/studio/engine/compose';
import { AnnotateView } from './components/AnnotateView';
import { MARKUP_TOOLS, MarkupToolbar, type MarkupControls } from './components/MarkupToolbar';
import { DEFAULT_PANEL, SidePanel, type PanelPrefs } from './components/SidePanel';
import { ZoomControl, stepZoom, type Zoom } from './components/ZoomControl';
import { useTheme } from '@/shared/theme';
import type { Theme } from '@/shared/settings';
import { BreaksPanel, PageMarkPanel, PagesPanel } from './components/Panel';
import { DetailsPanel } from './components/DetailsPanel';
import { buildDetails } from '@/studio/engine/details';
import { DEFAULT_ENGINE, pagesNeedingOcr } from '@screenscroll/core/ocr';
import { downloadModel, readImage, setE2eModelBase } from '@/ocr/client';
import { modelStatus, type ModelStatus } from '@/ocr/store';
import { SaveMenu, type ExportFormat } from './components/SaveMenu';
import { PagesView } from './components/PagesView';
import { StripView } from './components/StripView';
import { Thumbnails } from './components/Thumbnails';
import { exportDebugOverlay } from './debug-export';

type Stage =
  | { kind: 'loading' }
  | { kind: 'analysing'; done: number; total: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

type View = 'pages' | 'breaks' | 'markup';

/** Three modes, named by what you do in them (UI §3, distilled). */
const MODES: Array<[View, string, typeof FileText, string]> = [
  ['pages', 'Pages', FileText, 'See the pages as they will be saved'],
  ['breaks', 'Breaks', SeparatorHorizontal, 'Move, add or remove page breaks'],
  ['markup', 'Mark up', PenLine, 'Draw, write, hide private details, crop'],
];

export type { Edits } from '@/studio/engine/plan';

const params = new URLSearchParams(location.search);
const SESSION_ID = params.get('session') ?? '';
const AUTO = params.get('auto'); // 'pdf' = UI §1 "Save PDF directly"

export function App() {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [session, setSession] = useState<LoadedSession | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [edits, setEdits] = useState<Edits>({ pinned: [], removed: [] });
  const [view, setViewState] = useState<View>('pages');
  // Per-viewer UI memory (zoom, panel); nothing here needs to sync or persist reliably.
  const [zoom, setZoom] = useState<Zoom>(() => readPref('ss-zoom', 'page' as Zoom));
  const [effective, setEffective] = useState(1);
  const changeZoom = useCallback((z: Zoom) => {
    setZoom(z);
    writePref('ss-zoom', z);
  }, []);
  const [panelPrefs, setPanelPrefs] = useState<PanelPrefs>(() => ({
    ...DEFAULT_PANEL,
    ...readPref('ss-panel', DEFAULT_PANEL),
  }));
  const changePanel = useCallback((p: PanelPrefs) => {
    setPanelPrefs(p);
    writePref('ss-panel', p);
  }, []);
  const [theme, setTheme] = useTheme();
  const [history, setHistory] = useState<History<Project>>(() => emptyHistory(EMPTY_PROJECT));
  const [tool, setTool] = useState<Tool>('rect');
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [selected, setSelected] = useState<string | null>(null);
  const project = history.present;
  const annotations = project.annotations;
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const frames = useRef<FrameCache | null>(null);
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, st] = await Promise.all([loadSession(SESSION_ID), loadSettings()]);
        if (cancelled) return;
        document.title = `${s.session.title || 'Capture'} · ScreenScroll`;
        frames.current = new FrameCache(s.frames);
        setHistory(emptyHistory(s.project));
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

  const result = useMemo(
    (): PageResult | null =>
      session && analysis && settings
        ? planPages(
            session,
            analysis,
            settings,
            { crop: project.crop, annotations, sheetGrid: project.sheetGrid },
            edits,
          )
        : null,
    [session, analysis, settings, edits, project.crop, annotations, project.sheetGrid],
  );

  // Projects are saved as they change, so they can be re-edited later (TODO M4).
  const loaded = useRef<Project | null>(null);
  useEffect(() => {
    if (!session) return;
    if (loaded.current === null) {
      loaded.current = project;
      return;
    }
    const t = setTimeout(() => void saveProject(SESSION_ID, project), 250);
    const flush = () => void saveProject(SESSION_ID, project);
    addEventListener('pagehide', flush);
    return () => {
      clearTimeout(t);
      removeEventListener('pagehide', flush);
    };
  }, [session, project]);

  const changeProject = useCallback(
    (patch: Partial<Project>) => setHistory((h) => commit(h, { ...h.present, ...patch })),
    [],
  );
  const setAnnotations = useCallback(
    (next: Annotation[]) => changeProject({ annotations: next }),
    [changeProject],
  );
  const setCrop = useCallback((crop: Region | null) => changeProject({ crop }), [changeProject]);
  const doUndo = useCallback(() => {
    setHistory(undo);
    setSelected(null);
  }, []);
  const doRedo = useCallback(() => {
    setHistory(redo);
    setSelected(null);
  }, []);
  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setHistory((h) =>
      commit(h, {
        ...h.present,
        annotations: h.present.annotations.filter((a) => a.id !== selected),
      }),
    );
    setSelected(null);
  }, [selected]);
  const changeStyle = useCallback(
    (next: Style) => {
      setStyle(next);
      if (selected)
        setHistory((h) =>
          commit(h, {
            ...h.present,
            annotations: h.present.annotations.map((a) =>
              a.id === selected ? { ...a, style: next } : a,
            ),
          }),
        );
    },
    [selected],
  );
  const setView = setViewState;

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
  // Text recognition (Settings → Text recognition): which pages need it, and the model.
  const [ocrModel, setOcrModel] = useState<ModelStatus | null>(null);
  const [ocrDownload, setOcrDownload] = useState<{ done: number; total: number } | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      if (__SP_E2E__) {
        const { e2eOcrBase } = await chrome.storage.local.get('e2eOcrBase');
        setE2eModelBase(typeof e2eOcrBase === 'string' ? e2eOcrBase : undefined);
      }
      setOcrModel(await modelStatus(DEFAULT_ENGINE).catch(() => null));
    })();
  }, []);
  const ocrPages = useMemo(
    () =>
      session && settings ? pagesNeedingOcr(settings.ocr, slices, session.hints.textRuns) : [],
    [session, settings, slices],
  );
  const pageOcr = useMemo(
    () =>
      ocrModel?.ready && ocrPages.length
        ? { pages: new Set(ocrPages), read: readImage }
        : undefined,
    [ocrModel, ocrPages],
  );
  const getOcrModel = useCallback(async () => {
    setOcrError(null);
    setOcrDownload({ done: 0, total: 1 });
    try {
      await downloadModel((done, total) => setOcrDownload({ done, total }));
      setOcrModel(await modelStatus(DEFAULT_ENGINE));
    } catch (e) {
      setOcrError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcrDownload(null);
    }
  }, []);
  const [showDetails, setShowDetails] = useState(() => readPref('sp.details', false));
  useEffect(() => writePref('sp.details', showDetails), [showDetails]);
  const details = useMemo(
    () =>
      session && settings && result?.ok
        ? buildDetails({
            session,
            settings,
            layout: result.layout,
            crop: result.crop,
            slices,
            sheets: result.sheets,
            estimate,
            ocr: { pages: ocrPages, ready: !!ocrModel?.ready },
          })
        : null,
    [session, settings, result, slices, estimate, ocrPages, ocrModel],
  );
  useEffect(() => {
    if (!session || !result?.ok || !settings || !frames.current) return;
    const f = frames.current;
    let cancelled = false;
    setEstimate(null);
    const t = setTimeout(async () => {
      const sample = [...new Set([0, Math.floor(slices.length / 2)])].filter((i) => slices[i]);
      let bytes = 0;
      for (const i of sample) {
        const spec = QUALITY[settings.exportPreset];
        const scale = exportScale(session.dpr, result.layout.s, spec);
        const img = await encodePage(
          await composePage(session, f, slices[i]!, scale, annotations, settings.pdf.filter),
          slices[i]!,
          spec,
        );
        bytes += img.bytes.length;
      }
      if (!cancelled && sample.length) setEstimate((bytes / sample.length) * slices.length);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [session, result, settings, slices, annotations]);

  // The UI changes at once; writes are queued so they land in order (fast typing in a text
  // field would otherwise lose characters, or an older write could finish last).
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => prev && { ...prev, ...patch });
    saving.current = saving.current.then(() => saveSettings(patch)).catch(() => undefined);
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
      // One job at a time: a double click or a held Ctrl+S must not save twice.
      if (running.current) return null;
      running.current = true;
      setBusy(label);
      try {
        const done = await job((d, t) => setBusy(`${label} ${d}/${t}`));
        if (done) setToast(done);
        return { ok: true, text: done || '' };
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        setToast(text);
        return { ok: false, text };
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [],
  );

  const doExport = useCallback(
    async (format: ExportFormat) => {
      if (!session || !result || !result.ok || !settings || !frames.current) return null;
      const f = frames.current;
      const { layout, crop } = result;
      return run('Exporting', async (progress) => {
        switch (format) {
          case 'pdf': {
            const bytes = await exportPdf(
              session,
              f,
              slices,
              layout,
              settings.exportPreset,
              settings.pdf,
              progress,
              annotations,
              pageOcr,
            );
            return saved(
              await download(bytes, filename('pdf'), 'application/pdf'),
              filename('pdf'),
            );
          }
          case 'pdf-long': {
            const bytes = await exportLongPagePdf(
              session,
              f,
              slices,
              layout,
              settings.exportPreset,
              settings.pdf,
              progress,
              annotations,
              pageOcr,
            );
            return saved(
              await download(bytes, filename('pdf'), 'application/pdf'),
              filename('pdf'),
            );
          }
          case 'png':
          case 'jpeg':
          case 'webp': {
            const base = filename('zip').replace(/\.zip$/, '');
            const bytes = await exportPageImagesZip(
              session,
              f,
              slices,
              format,
              base,
              progress,
              annotations,
              settings.pdf.filter,
            );
            return saved(
              await download(bytes, filename('zip'), 'application/zip'),
              filename('zip'),
            );
          }
          case 'long-png': {
            const parts = await exportLongImage(
              session,
              f,
              crop,
              'png',
              progress,
              annotations,
              { y0: slices[0]!.y0, y1: slices.at(-1)!.y1 },
              settings.pdf.filter,
            );
            if (parts.length === 1) {
              return saved(
                await download(parts[0]!, filename('png'), 'image/png'),
                filename('png'),
              );
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
            const name = await download(zip, filename('zip'), 'application/zip');
            return `The image was too tall for one file; ${saved(name, filename('zip')).replace('Saved', 'saved')} (${parts.length} parts)`;
          }
        }
      });
    },
    [session, result, settings, slices, filename, run, annotations, pageOcr],
  );

  const doPrint = useCallback(async () => {
    if (!session || !result || !result.ok || !settings || !frames.current) return;
    const f = frames.current;
    await run('Preparing PDF', async (progress) => {
      openPdfForPrint(
        await exportPdf(
          session,
          f,
          slices,
          result.layout,
          settings.exportPreset,
          settings.pdf,
          progress,
          annotations,
          pageOcr,
        ),
      );
    });
  }, [session, result, settings, slices, run, annotations, pageOcr]);

  const doCopy = useCallback(async () => {
    if (!session || !frames.current || !slices[page]) return;
    const f = frames.current;
    await run('Copying', async () => {
      await copyPageImage(session, f, slices[page]!, annotations, settings?.pdf.filter);
      return `Page ${page + 1} copied as an image`;
    });
  }, [session, slices, page, run, annotations, settings]);

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

  /** Area mode → Copy: the whole capture as one PNG on the clipboard. */
  const doCopyAll = useCallback(async () => {
    if (!session || !result || !result.ok || !settings || !frames.current || !slices.length)
      return null;
    const f = frames.current;
    const { crop } = result;
    return run('Copying', async () => {
      const range = { y0: slices[0]!.y0, y1: slices.at(-1)!.y1 };
      const parts = await exportLongImage(
        session,
        f,
        crop,
        'png',
        undefined,
        annotations,
        range,
        settings.pdf.filter,
      );
      if (parts.length > 1)
        throw new Error('Too tall to copy as one image. Use Save PDF or save it as images.');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': parts[0]! })]);
      const px = (v: number) => Math.round(v * session.dpr);
      return `Copied as an image · ${px(crop.x1 - crop.x0)} × ${px(range.y1 - range.y0)} px`;
    });
  }, [session, result, settings, slices, run, annotations]);

  // UI §1 fast path (and area mode's PDF and Copy): do it, say so on the captured page, and
  // close this tab. On failure the tab stays open with the reason.
  const autoDone = useRef(false);
  useEffect(() => {
    if (!AUTO || autoDone.current || stage.kind !== 'ready' || !result || !result.ok) return;
    autoDone.current = true;
    const tabId = session?.session.tabId;
    const job = AUTO === 'copy' ? doCopyAll() : doExport('pdf');
    void job.then((r) => {
      if (!r?.ok) return;
      void chrome.runtime
        .sendMessage({ type: 'sp:notice', text: r.text, tabId })
        .catch(() => undefined);
      setTimeout(() => window.close(), 500);
    });
  }, [stage, result, doExport, doCopyAll, session]);

  // Keyboard (UI §3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        doRedo();
      } else if (mod && key === 'z') {
        e.preventDefault();
        doUndo();
      } else if (
        view === 'markup' &&
        !mod &&
        !e.altKey &&
        TOOL_KEYS[key] &&
        MARKUP_TOOLS.has(TOOL_KEYS[key])
      ) {
        setTool(TOOL_KEYS[key]);
      } else if (view === 'markup' && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteSelected();
      } else if (view === 'markup' && e.key === 'Escape') {
        setSelected(null);
      } else if (!mod && !e.altKey && key === 'i') {
        setShowDetails((v) => !v);
      } else if (!mod && (e.key === '+' || e.key === '=')) {
        changeZoom(stepZoom(effective, 1));
      } else if (!mod && e.key === '-') {
        changeZoom(stepZoom(effective, -1));
      } else if (!mod && e.key === '0') {
        changeZoom(view === 'markup' ? 'width' : 'page');
      } else if (mod && e.shiftKey && key === 'd') {
        // Developer aid (PAGINATION §9): the break overlay, kept out of the visible UI.
        e.preventDefault();
        void doDebug();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void doExport('pdf');
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void doCopy();
      } else if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void doPrint();
      } else if (view !== 'markup' && e.key === 'ArrowRight')
        setPage((p) => Math.min(slices.length - 1, p + 1));
      else if (view !== 'markup' && e.key === 'ArrowLeft') setPage((p) => Math.max(0, p - 1));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [
    doExport,
    doCopy,
    doPrint,
    doDebug,
    doUndo,
    doRedo,
    deleteSelected,
    view,
    slices.length,
    effective,
    changeZoom,
  ]);

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
        project: () => project,
        size: () => ({ width: session.width, height: session.height }),
        async pdfBase64() {
          const bytes = await exportPdf(
            session,
            f,
            result.debug.slices,
            result.layout,
            settings.exportPreset,
            settings.pdf,
            undefined,
            project.annotations,
            pageOcr,
          );
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000)
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(bin);
        },
      },
    });
  }, [session, result, settings, warnings, project, pageOcr]);

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

  const panelBody =
    showDetails && details ? (
      <DetailsPanel details={details} onClose={() => setShowDetails(false)} />
    ) : view === 'pages' || !result.ok ? (
      <PagesPanel
        settings={settings}
        onSettings={updateSettings}
        filename={filename('pdf')}
        cropped={result.ok && result.crop.cropped}
        sheetCount={analysis.sheets?.sheets.length ?? null}
        sheets={{
          detected: analysis.sheets,
          grid: project.sheetGrid ?? null,
          pages: result.ok && result.sheets ? result.debug.slices.length : 0,
          width: session.width,
          onGrid: (sheetGrid) => changeProject({ sheetGrid }),
        }}
        estimate={estimate}
        ocr={{
          pages: ocrPages.map((i) => i + 1),
          ready: !!ocrModel?.ready,
          size: ocrModel?.total ?? 0,
          downloading: ocrDownload,
          error: ocrError,
          onDownload: () => void getOcrModel(),
        }}
      />
    ) : view === 'breaks' ? (
      <BreaksPanel
        edits={edits}
        onReset={() => setEdits({ pinned: [], removed: [] })}
        locked={result.ok && result.sheets}
      />
    ) : view === 'markup' ? (
      <PageMarkPanel settings={settings} onSettings={updateSettings}>
        <RedactCard
          runs={session.hints.textRuns}
          slices={slices}
          covered={redactions(annotations)}
          onBlur={(rects) =>
            changeProject({
              annotations: [
                ...annotations,
                ...rects.map(
                  (r): Annotation => ({
                    id: crypto.randomUUID(),
                    kind: 'blur',
                    style: DEFAULT_STYLE,
                    x: r.x,
                    y: r.y,
                    w: r.width,
                    h: r.height,
                  }),
                ),
              ],
            })
          }
        />
      </PageMarkPanel>
    ) : null;
  const panel = panelBody && (
    <SidePanel prefs={panelPrefs} onPrefs={changePanel} label="panel">
      {panelBody}
    </SidePanel>
  );

  const markup: MarkupControls = {
    tool,
    onTool: setTool,
    style,
    onStyle: changeStyle,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    onUndo: doUndo,
    onRedo: doRedo,
    selected: !!selected && annotations.some((a) => a.id === selected),
    onDelete: deleteSelected,
    count: annotations.length,
    onClear: () => {
      setAnnotations([]);
      setSelected(null);
    },
    cropped: !!project.crop,
    onResetCrop: () => setCrop(null),
  };

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-[13px] text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold" title={session.session.title}>
            {session.session.title || 'Untitled capture'}
          </h1>
          <p className="truncate text-[12px] text-neutral-500">
            {[
              domain,
              captured,
              result.ok ? `${slices.length} ${slices.length === 1 ? 'page' : 'pages'}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Mode"
          className="flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800"
        >
          {MODES.map(([v, label, Icon, hint]) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={view === v}
              title={hint}
              disabled={!result.ok}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 focus-visible:outline-2 focus-visible:outline-accent ${view === v ? 'bg-white font-medium shadow-sm dark:bg-neutral-700' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'}`}
            >
              <Icon aria-hidden size={15} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          {warnings.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowWarnings((v) => !v)}
                aria-expanded={showWarnings}
                className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 focus-visible:outline-2 focus-visible:outline-accent dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
              >
                <TriangleAlert aria-hidden size={14} />
                {warnings.length} {warnings.length === 1 ? 'note' : 'notes'}
              </button>
              {showWarnings && (
                <ul
                  data-testid="warnings"
                  className="absolute right-0 z-20 mt-1 w-96 max-w-[80vw] rounded-md border border-neutral-200 bg-white p-2 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
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
                              setView('pages');
                              setShowWarnings(false);
                            }}
                          >
                            {w}
                          </button>
                        ) : w === OVERLAY_WARNING ? (
                          <>
                            {w}
                            <button
                              type="button"
                              className="mt-1 block rounded-md border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:border-neutral-700 dark:hover:bg-neutral-800"
                              onClick={() => {
                                setShowWarnings(false);
                                void chrome.runtime
                                  .sendMessage({ type: 'sp:recapture', sessionId: SESSION_ID })
                                  .then((r: { ok: boolean; error?: string }) => {
                                    if (!r.ok) setToast(r.error ?? 'Could not capture again.');
                                  });
                              }}
                            >
                              Hide pop-ups and capture again
                            </button>
                          </>
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
            aria-label="Details"
            aria-pressed={showDetails}
            title="Details: every number and how it was calculated (I)"
            onClick={() => setShowDetails((v) => !v)}
            className={`rounded-md p-1.5 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800 ${showDetails ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-white' : 'text-neutral-600 dark:text-neutral-300'}`}
          >
            <Info aria-hidden size={17} />
          </button>
          <ThemeButton theme={theme} onTheme={setTheme} />
          <SaveMenu
            disabled={!!busy || !result.ok}
            onExport={doExport}
            onCopy={doCopy}
            onPrint={doPrint}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {panel && panelPrefs.side === 'left' && panel}
        {result.ok ? (
          <>
            {view !== 'markup' && (
              <Thumbnails
                analysis={analysis}
                slices={slices}
                page={page}
                onSelect={setPage}
                annotations={annotations}
                filter={settings.pdf.filter}
              />
            )}
            <main className="relative flex min-w-0 flex-1 flex-col">
              {view !== 'breaks' && (
                <div className="absolute right-4 bottom-4 z-20">
                  <ZoomControl
                    zoom={zoom}
                    effective={effective}
                    onZoom={changeZoom}
                    pageFit={view === 'pages'}
                  />
                </div>
              )}
              {view === 'pages' ? (
                <PagesView
                  watermark={settings.pdf.watermark}
                  filter={settings.pdf.filter}
                  session={session}
                  frames={frames.current!}
                  analysis={analysis}
                  slices={slices}
                  layout={result.layout}
                  page={page}
                  onSelect={setPage}
                  annotations={annotations}
                  zoom={zoom}
                  onZoom={changeZoom}
                  onEffective={setEffective}
                />
              ) : view === 'markup' ? (
                <>
                  <MarkupToolbar {...markup} />
                  <AnnotateView
                    session={session}
                    frames={frames.current!}
                    annotations={annotations}
                    crop={project.crop}
                    tool={tool}
                    style={style}
                    selected={selected}
                    onSelect={setSelected}
                    onAnnotations={setAnnotations}
                    onCrop={(c) => {
                      setCrop(c);
                      setTool('select');
                    }}
                    zoom={zoom}
                    onZoom={changeZoom}
                    onEffective={setEffective}
                    filter={settings.pdf.filter}
                    watermark={settings.pdf.watermark}
                    slices={slices}
                    scale={result.ok ? result.layout.s : 1}
                  />
                </>
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
                  locked={result.sheets}
                />
              )}
            </main>
          </>
        ) : (
          <main className="flex flex-1 items-center justify-center p-6">
            <p role="alert">{result.error}</p>
          </main>
        )}
        {panel && panelPrefs.side === 'right' && panel}
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

const THEMES: Array<[Theme, string, typeof Sun]> = [
  ['system', 'System', Monitor],
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
];

/** One button that cycles system → light → dark; its label says which is on. */
function ThemeButton({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  const i = THEMES.findIndex(([t]) => t === theme);
  const [, label, Icon] = THEMES[i]!;
  const next = THEMES[(i + 1) % THEMES.length]!;
  return (
    <button
      type="button"
      aria-label={`Theme: ${label}`}
      title={`Theme: ${label}. Click for ${next[1].toLowerCase()}.`}
      onClick={() => onTheme(next[0])}
      className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <Icon aria-hidden size={17} />
    </button>
  );
}

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not essential */
  }
}

/** Toast text for a finished save, explaining a changed file name. */
function saved(name: string, wanted: string): string {
  return name === wanted
    ? `Saved ${name}`
    : `Saved as ${name}. The browser did not accept the page title as a file name.`;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center text-[13px] text-neutral-700 dark:text-neutral-300">
      {children}
    </div>
  );
}
