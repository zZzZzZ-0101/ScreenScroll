import {
  buildFilename,
  commit,
  DEFAULT_STYLE,
  findPageNumbers,
  findRunningLines,
  findTextMatches,
  confidentReading,
  gridOf,
  breaksToCheck,
  redactions,
  emptyHistory,
  exportScale,
  pageDpi,
  QUALITY,
  redo,
  TOOL_KEYS,
  undo,
  medianFontPx,
  moveByClamped,
  readabilityAdvice,
  type Annotation,
  type History,
  type Rect,
  type Region,
  type Style,
  type Tool,
} from '@screenscroll/core';
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Info,
  Monitor,
  Moon,
  PenLine,
  Redo2,
  Search,
  SeparatorHorizontal,
  Sun,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_PROJECT, saveProject, type OcrMeta, type Project } from '@/shared/db';
import { OVERLAY_WARNING } from '@/shared/messages';
import { RedactCard, type RedactKind } from './components/RedactCard';
import { loadSettings, saveSettings, type Settings } from '@/shared/settings';
import { analyze, type Analysis } from '@/studio/engine/analysis';
import {
  allTextRuns,
  applyPageSelection,
  effectiveAnnotations,
  isNaturalOrder,
  NO_EDITS,
  pagesMode,
  pdfFor,
  planPages,
  type PageResult,
} from '@/studio/engine/plan';
import {
  copyPageImage,
  download,
  exportLongImage,
  exportLongPagePdf,
  exportPageImagesZip,
  exportText,
  exportPdf,
  ext,
  extractRunsText,
  hasCachedOcr,
  openPdfForPrint,
  readPagesOcr,
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
import { t } from '@/shared/i18n';

const measureCtx = new OffscreenCanvas(1, 1).getContext('2d')!;
function measureTextPx(px: number) {
  return (text: string) => {
    measureCtx.font = `${px}px Arial, Helvetica, sans-serif`;
    return measureCtx.measureText(text).width;
  };
}

function isRectCovered(rect: Rect, covered: readonly Rect[]): boolean {
  return covered.some(
    (c) =>
      c.x <= rect.x + 1 &&
      c.y <= rect.y + 1 &&
      c.x + c.width >= rect.x + rect.width - 1 &&
      c.y + c.height >= rect.y + rect.height - 1,
  );
}

type WarningItem = {
  text: string;
  page?: number;
  action?: 'recapture' | 'toggle-seams';
};

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
  const [view, setViewState] = useState<View>('pages');
  // Per-viewer UI memory (zoom, panel); nothing here needs to sync or persist reliably.
  const [zoom, setZoom] = useState<Zoom>(() => readPref('ss-zoom', 'width' as Zoom));
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
  const edits = project.edits ?? NO_EDITS;
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [seamBusy, setSeamBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIdx, setSearchIdx] = useState(0);
  const [highlight, setHighlight] = useState<{ rect: Rect; seq: number } | null>(null);
  const [stripJumpY, setStripJumpY] = useState<{ y: number; seq: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const jumpSeq = useRef(0);
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
        const a = await analyze(
          s,
          frames.current,
          (done, total) => setStage({ kind: 'analysing', done, total }),
          { alignSeams: !s.project.rawSeams },
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
      frames.current?.clear();
    };
  }, []);

  const seamMode = !!project.rawSeams;
  const prevSeamMode = useRef<boolean | null>(null);
  useEffect(() => {
    if (!session || !frames.current) return;
    if (prevSeamMode.current === null) {
      prevSeamMode.current = seamMode;
      return;
    }
    if (prevSeamMode.current === seamMode) return;
    prevSeamMode.current = seamMode;
    let cancelled = false;
    setSeamBusy(true);
    void analyze(session, frames.current, undefined, { alignSeams: !seamMode })
      .then((a) => {
        if (!cancelled) setAnalysis(a);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setToast(
            t('Could not update seam alignment: {why}', {
              why: e instanceof Error ? e.message : String(e),
            }),
          );
      })
      .finally(() => {
        if (!cancelled) setSeamBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, seamMode]);

  const activeSession = useMemo(
    (): LoadedSession | null =>
      session && analysis
        ? { ...session, geoms: analysis.geoms, height: analysis.height }
        : session,
    [session, analysis],
  );

  const result = useMemo(
    (): PageResult | null =>
      activeSession && analysis && settings
        ? planPages(activeSession, analysis, settings, {
            crop: project.crop,
            annotations,
            edits,
            sheetGrid: project.sheetGrid,
            pages: project.pages,
          })
        : null,
    [
      activeSession,
      analysis,
      settings,
      edits,
      project.crop,
      annotations,
      project.sheetGrid,
      project.pages,
    ],
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

  const rawSlices = useMemo(() => (result && result.ok ? result.debug.slices : []), [result]);
  const selection = useMemo(
    () => applyPageSelection(rawSlices, project),
    [rawSlices, project.excludedPages, project.pageOrder],
  );
  const slices = selection.activeSlices;
  const activePage = slices.length > 0 ? Math.min(page, slices.length - 1) : 0;
  useEffect(() => {
    if (slices.length > 0 && page >= slices.length) setPage(slices.length - 1);
  }, [page, slices.length]);
  const stripPage = selection.activeIndices[activePage] ?? activePage;

  const toggleExcludePage = useCallback(
    (origIdx: number) => {
      setHistory((h) => {
        const sel = applyPageSelection(rawSlices, h.present);
        const nextExcluded = new Set(sel.excludedSet);
        if (nextExcluded.has(origIdx)) {
          nextExcluded.delete(origIdx);
        } else {
          if (sel.activeIndices.length <= 1) return h;
          nextExcluded.add(origIdx);
        }
        const excludedPages =
          nextExcluded.size > 0 ? [...nextExcluded].sort((a, b) => a - b) : undefined;
        return commit(h, { ...h.present, excludedPages });
      });
    },
    [rawSlices],
  );

  const movePage = useCallback(
    (pos: number, dir: -1 | 1) => {
      const currentOrig = selection.activeIndices[activePage];
      const nextOrder = [...selection.orderedIndices];
      const target = pos + dir;
      if (target < 0 || target >= nextOrder.length) return;
      [nextOrder[pos], nextOrder[target]] = [nextOrder[target]!, nextOrder[pos]!];
      const pageOrder = isNaturalOrder(nextOrder) ? undefined : nextOrder;
      changeProject({ pageOrder });
      if (currentOrig !== undefined) {
        const nextSel = applyPageSelection(rawSlices, { ...project, pageOrder });
        const nextActive = nextSel.activeIndices.indexOf(currentOrig);
        if (nextActive >= 0) setPage(nextActive);
      }
    },
    [selection, activePage, changeProject, rawSlices, project],
  );

  const includeAllPages = useCallback(
    () => changeProject({ excludedPages: undefined }),
    [changeProject],
  );
  const resetPageOrder = useCallback(
    () => changeProject({ pageOrder: undefined }),
    [changeProject],
  );

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (!selected || !activeSession) return;
      const docBounds = { width: activeSession.width, height: activeSession.height };
      setHistory((h) => {
        let changed = false;
        const nextAnns = h.present.annotations.map((a) => {
          if (a.id !== selected) return a;
          const moved = moveByClamped(a, dx, dy, docBounds);
          if (moved !== a) changed = true;
          return moved;
        });
        return changed ? commit(h, { ...h.present, annotations: nextAnns }) : h;
      });
    },
    [selected, activeSession],
  );

  const redactRects = useCallback((rects: Rect[], kind: RedactKind) => {
    if (!rects.length) return;
    setHistory((h) =>
      commit(h, {
        ...h.present,
        annotations: [
          ...h.present.annotations,
          ...rects.map(
            (r): Annotation => ({
              id: crypto.randomUUID(),
              kind,
              style: DEFAULT_STYLE,
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
            }),
          ),
        ],
      }),
    );
  }, []);

  const jumpToRect = useCallback((rect: Rect) => {
    setHighlight({ rect, seq: ++jumpSeq.current });
  }, []);

  // Export tab "estimated file size" (UI §3): encode the first and a middle page, extrapolate.
  const [estimate, setEstimate] = useState<number | null>(null);
  // Text recognition (Settings → Text recognition): which pages need it, and the model.
  const [ocrModel, setOcrModel] = useState<ModelStatus | null>(null);
  const [ocrDownload, setOcrDownload] = useState<{ done: number; total: number } | null>(null);
  const [ocrReading, setOcrReading] = useState<{ done: number; total: number } | null>(null);
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
      activeSession && settings
        ? pagesNeedingOcr(settings.ocr, slices, activeSession.hints.textRuns)
        : [],
    [activeSession, settings, slices],
  );
  const onOcrCached = useCallback((runs: LoadedSession['ocrRuns'], meta: OcrMeta) => {
    setSession((prev) => (prev ? { ...prev, ocrRuns: runs, ocrMeta: meta } : prev));
  }, []);
  const pageOcr = useMemo(
    () =>
      ocrModel?.ready && ocrPages.length
        ? { pages: new Set(ocrPages), read: readImage, onCached: onOcrCached }
        : undefined,
    [ocrModel, ocrPages, onOcrCached],
  );
  const ocrReadCount = useMemo(
    () =>
      activeSession &&
      settings &&
      ocrPages.length > 0 &&
      hasCachedOcr(activeSession, slices, settings.pdf.filter, ocrPages.length)
        ? activeSession.ocrRuns.length
        : null,
    [activeSession, settings, slices, ocrPages.length],
  );

  // Only include cached OCR runs when they are still valid for the active filter & slice range.
  const allRuns = useMemo(
    () =>
      activeSession
        ? allTextRuns(
            activeSession,
            settings
              ? { slices, filter: settings.pdf.filter, ocrPageCount: ocrPages.length }
              : undefined,
          )
        : [],
    [activeSession, settings, slices, ocrPages.length],
  );

  // The document's own page numbers (document pages only), and what hiding or renumbering
  // them draws on export: derived, never stored, so either switch turns back exactly.
  const pageNumbers = useMemo(
    () => (result?.ok && result.sheets ? findPageNumbers(result.debug.slices, allRuns) : null),
    [allRuns, result],
  );
  const runningLines = useMemo(
    () => (result?.ok && result.sheets ? findRunningLines(result.debug.slices, allRuns) : []),
    [allRuns, result],
  );
  const outAnns = useMemo(
    () =>
      activeSession
        ? effectiveAnnotations(activeSession, result, project, settings?.pdf.filter)
        : annotations,
    [activeSession, result, project, annotations, settings?.pdf.filter],
  );

  const checks = useMemo(() => breaksToCheck(rawSlices), [rawSlices]);
  // The page grid shown for dragging: the one set by hand, else the detected or best reading.
  const editGrid = useMemo(() => {
    if (project.sheetGrid && project.pages !== 'auto') return project.sheetGrid;
    const l = analysis?.sheets ?? (analysis ? confidentReading(analysis.readings)?.layout : null);
    return l ? gridOf(l) : null;
  }, [project.sheetGrid, project.pages, analysis]);
  const fontPx = useMemo(
    () => (allRuns.length ? medianFontPx(allRuns.map((t) => t.fontSizePx)) : null),
    [allRuns],
  );

  const warningItems = useMemo((): WarningItem[] => {
    if (!activeSession || !result || !result.ok) return [];
    const list: WarningItem[] = [];
    const pushRaw = (text: string) => {
      const m = /^Page (\d+):/.exec(text);
      const pageNum = m ? Math.min(Math.max(0, slices.length - 1), Math.max(0, Number(m[1]) - 1)) : undefined;
      list.push({
        text,
        page: pageNum,
        action: text === OVERLAY_WARNING ? 'recapture' : undefined,
      });
    };
    if (activeSession.session.status === 'cancelled')
      list.push({ text: 'Capture was cancelled; this is what was captured.' });
    if (activeSession.session.status === 'error')
      list.push({ text: 'Capture stopped early; this is what was captured.' });
    for (const w of activeSession.session.warnings) pushRaw(w);
    if (project.rawSeams) {
      list.push({
        text: t('Automatic seam alignment is turned off for this capture.'),
        action: 'toggle-seams',
      });
    } else if (analysis) {
      if (analysis.adjustedSeamPx > 0) {
        list.push({
          text: t('Screen seams were realigned by {px} px using image matching.', {
            px: analysis.adjustedSeamPx,
          }),
          action: 'toggle-seams',
        });
      }
      for (const seam of analysis.seams) {
        if (seam.kind !== 'unverified') continue;
        const idx = slices.findIndex((sl) => seam.y >= sl.y0 && seam.y <= sl.y1);
        if (idx >= 0) {
          list.push({
            text: t('Page {n}: screen seam could not be verified (content changed while capturing).', {
              n: idx + 1,
            }),
            page: idx,
            action: 'toggle-seams',
          });
        } else {
          list.push({
            text: t('A screen seam could not be verified (content changed while capturing).'),
            action: 'toggle-seams',
          });
        }
      }
    }
    const advice = readabilityAdvice(
      medianFontPx(allRuns.map((t) => t.fontSizePx)),
      result.layout.s,
    );
    if (advice) pushRaw(advice);
    if (result.layout.scaleClamped)
      pushRaw('The fixed scale was reduced so the page fits the paper width.');
    for (const s of slices) for (const w of s.warnings) pushRaw(w);
    return list;
  }, [activeSession, analysis, project.rawSeams, allRuns, result, slices]);

  const warnings = useMemo(() => warningItems.map((w) => w.text), [warningItems]);

  const searchMatches = useMemo(() => {
    if (!searchOpen || !searchQuery.trim()) return [];
    const hits = findTextMatches(allRuns, searchQuery, { measure: measureTextPx })
      .map((m) => {
        const cy = m.rect.y + m.rect.height / 2;
        const pageIndex = slices.findIndex((s) => cy >= s.y0 && cy < s.y1);
        return { ...m, pageIndex };
      })
      .filter((m) => m.pageIndex >= 0 || slices.length === 0);
    hits.sort((a, b) => a.pageIndex - b.pageIndex || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    return hits;
  }, [searchOpen, searchQuery, allRuns, slices]);

  const activeSearchIdx =
    searchMatches.length > 0 ? ((searchIdx % searchMatches.length) + searchMatches.length) % searchMatches.length : 0;

  useEffect(() => {
    if (!searchOpen) return;
    const active = searchMatches[activeSearchIdx];
    if (active) jumpToRect(active.rect);
    else setHighlight(null);
  }, [searchOpen, searchMatches, activeSearchIdx, jumpToRect]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setHighlight(null);
  }, []);

  const readOcrNow = useCallback(async () => {
    if (
      !activeSession ||
      !result?.ok ||
      !settings ||
      !frames.current ||
      !ocrModel?.ready ||
      !ocrPages.length
    )
      return;
    setOcrError(null);
    setOcrReading({ done: 0, total: ocrPages.length });
    try {
      const { runs, meta } = await readPagesOcr(
        activeSession,
        frames.current,
        slices,
        result.layout,
        settings.exportPreset,
        settings.pdf.filter,
        ocrPages,
        readImage,
        (done, total) => setOcrReading({ done, total }),
      );
      onOcrCached(runs, meta);
    } catch (e) {
      setOcrError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcrReading(null);
    }
  }, [activeSession, result, settings, ocrModel, ocrPages, slices, onOcrCached]);
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
      activeSession && settings && result?.ok
        ? buildDetails({
            session: activeSession,
            settings,
            layout: result.layout,
            crop: result.crop,
            slices,
            sheets: result.sheets,
            estimate,
            ocr: { pages: ocrPages, ready: !!ocrModel?.ready, cachedLines: ocrReadCount },
            seams: analysis
              ? {
                  adjustedPx: analysis.adjustedSeamPx,
                  unverified: analysis.unverifiedSeams,
                  count: analysis.seams.length,
                  rawSeams: !!project.rawSeams,
                }
              : undefined,
            excludedPages: selection.excludedSet.size,
            detection: analysis
              ? { evidence: analysis.evidence, readings: analysis.readings }
              : undefined,
          })
        : null,
    [
      activeSession,
      settings,
      result,
      slices,
      estimate,
      ocrPages,
      ocrModel,
      ocrReadCount,
      analysis,
      project.rawSeams,
      selection.excludedSet.size,
    ],
  );
  useEffect(() => {
    if (!activeSession || !result?.ok || !settings || !frames.current) return;
    const f = frames.current;
    let cancelled = false;
    setEstimate(null);
    const t = setTimeout(async () => {
      const sample = [...new Set([0, Math.floor(slices.length / 2)])].filter((i) => slices[i]);
      let bytes = 0;
      for (const i of sample) {
        const spec = QUALITY[settings.exportPreset];
        const scale = exportScale(activeSession.dpr, result.layout.s, spec);
        const img = await encodePage(
          await composePage(activeSession, f, slices[i]!, scale, outAnns, settings.pdf.filter),
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
  }, [activeSession, result, settings, slices, outAnns]);

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
      if (!activeSession || !result || !result.ok || !settings || !frames.current) return null;
      const f = frames.current;
      const { layout, crop } = result;
      return run('Exporting', async (progress) => {
        switch (format) {
          case 'pdf': {
            const bytes = await exportPdf(
              activeSession,
              f,
              slices,
              layout,
              settings.exportPreset,
              pdfFor(settings, result),
              progress,
              outAnns,
              pageOcr,
            );
            return saved(
              await download(bytes, filename('pdf'), 'application/pdf'),
              filename('pdf'),
            );
          }
          case 'pdf-long': {
            const bytes = await exportLongPagePdf(
              activeSession,
              f,
              slices,
              layout,
              settings.exportPreset,
              pdfFor(settings, result),
              progress,
              outAnns,
              pageOcr,
            );
            return saved(
              await download(bytes, filename('pdf'), 'application/pdf'),
              filename('pdf'),
            );
          }
          case 'md':
          case 'docx': {
            const bytes = await exportText(
              activeSession,
              f,
              slices,
              layout,
              settings.exportPreset,
              result.sheets,
              progress,
              outAnns,
              pageOcr,
              format,
              settings.pdf.filter,
            );
            return saved(
              await download(
                bytes,
                filename(format),
                format === 'md'
                  ? 'text/markdown'
                  : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              ),
              filename(format),
            );
          }
          case 'png':
          case 'jpeg':
          case 'webp': {
            const base = filename('zip').replace(/\.zip$/, '');
            const bytes = await exportPageImagesZip(
              activeSession,
              f,
              slices,
              format,
              base,
              progress,
              outAnns,
              settings.pdf.filter,
              settings.pdf.watermark,
              layout.s,
            );
            return saved(
              await download(bytes, filename('zip'), 'application/zip'),
              filename('zip'),
            );
          }
          case 'long-png': {
            const range = {
              y0: Math.min(...slices.map((s) => s.y0)),
              y1: Math.max(...slices.map((s) => s.y1)),
            };
            const parts = await exportLongImage(
              activeSession,
              f,
              crop,
              'png',
              progress,
              outAnns,
              range,
              settings.pdf.filter,
              { wm: settings.pdf.watermark, slices, s: layout.s },
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
    [activeSession, result, settings, slices, filename, run, outAnns, pageOcr],
  );

  const doPrint = useCallback(async () => {
    if (!activeSession || !result || !result.ok || !settings || !frames.current) return;
    const f = frames.current;
    await run('Preparing PDF', async (progress) => {
      openPdfForPrint(
        await exportPdf(
          activeSession,
          f,
          slices,
          result.layout,
          settings.exportPreset,
          pdfFor(settings, result),
          progress,
          outAnns,
          pageOcr,
        ),
      );
    });
  }, [activeSession, result, settings, slices, run, outAnns, pageOcr]);

  const doCopy = useCallback(async () => {
    if (!activeSession || !result || !result.ok || !frames.current || !slices[activePage]) return;
    const f = frames.current;
    await run('Copying', async () => {
      await copyPageImage(
        activeSession,
        f,
        slices[activePage]!,
        outAnns,
        settings?.pdf.filter,
        settings
          ? {
              wm: settings.pdf.watermark,
              pageIndex: activePage,
              pageCount: slices.length,
              s: result.layout.s,
            }
          : undefined,
      );
      return `Page ${activePage + 1} copied as an image`;
    });
  }, [activeSession, result, slices, activePage, run, outAnns, settings]);

  const doCopyText = useCallback(async () => {
    if (!activeSession || !result || !result.ok || !settings || !frames.current) return;
    const f = frames.current;
    await run(t('Copying text'), async (progress) => {
      const bytes = await exportText(
        activeSession,
        f,
        slices,
        result.layout,
        settings.exportPreset,
        result.sheets,
        progress,
        outAnns,
        pageOcr,
        'md',
        settings.pdf.filter,
      );
      const text = new TextDecoder().decode(bytes).trim();
      if (!text) throw new Error(t('No text to copy.'));
      await navigator.clipboard.writeText(text);
      return t('Copied text');
    });
  }, [activeSession, result, settings, slices, run, outAnns, pageOcr]);

  const doCopyOcrText = useCallback(async () => {
    if (!activeSession || !result || !result.ok) return;
    const text = extractRunsText(
      activeSession.ocrRuns,
      [],
      slices,
      result.sheets,
      outAnns,
    ).trim();
    if (!text) {
      setToast(t('No text to copy.'));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setToast(t('Copied text'));
    } catch (e) {
      setToast(
        t('Could not copy text: {why}', { why: e instanceof Error ? e.message : String(e) }),
      );
    }
  }, [activeSession, result, slices, outAnns]);

  const doDebug = useCallback(async () => {
    if (!activeSession || !analysis || !result || !result.ok) return;
    await run('Exporting overlay', async () => {
      const { png, json } = await exportDebugOverlay(analysis, result.debug, activeSession.width);
      await download(png, filename('png').replace(/\.png$/, '-breaks.png'), 'image/png');
      await download(
        new Blob([json], { type: 'application/json' }),
        filename('json').replace(/\.json$/, '-breaks.json'),
        'application/json',
      );
      return 'Saved break overlay (PNG and JSON)';
    });
  }, [activeSession, analysis, result, filename, run]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Area mode → Copy: the whole capture as one PNG on the clipboard. */
  const doCopyAll = useCallback(async () => {
    if (!activeSession || !result || !result.ok || !settings || !frames.current || !slices.length)
      return null;
    const f = frames.current;
    const { crop, layout } = result;
    return run('Copying', async () => {
      const range = {
        y0: Math.min(...slices.map((s) => s.y0)),
        y1: Math.max(...slices.map((s) => s.y1)),
      };
      const parts = await exportLongImage(
        activeSession,
        f,
        crop,
        'png',
        undefined,
        outAnns,
        range,
        settings.pdf.filter,
        { wm: settings.pdf.watermark, slices, s: layout.s },
      );
      if (parts.length > 1)
        throw new Error('Too tall to copy as one image. Use Save PDF or save it as images.');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': parts[0]! })]);
      const px = (v: number) => Math.round(v * activeSession.dpr);
      return `Copied as an image · ${px(crop.x1 - crop.x0)} × ${px(range.y1 - range.y0)} px`;
    });
  }, [activeSession, result, settings, slices, run, outAnns]);

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
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'f' && (view === 'pages' || view === 'markup')) {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea') || target.isContentEditable) return;
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        doRedo();
      } else if (mod && key === 'z') {
        e.preventDefault();
        doUndo();
      } else if (e.key === 'Escape' && searchOpen) {
        closeSearch();
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
        setTool('select');
      } else if (
        view === 'markup' &&
        selected &&
        !mod &&
        !e.altKey &&
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudgeSelected(
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        );
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
        setPage((p) => Math.min(Math.max(0, slices.length - 1), p + 1));
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
    nudgeSelected,
    closeSearch,
    searchOpen,
    selected,
    view,
    slices.length,
    effective,
    changeZoom,
  ]);

  // e2e hook (stripped from production builds).
  useEffect(() => {
    if (!__SP_E2E__ || !activeSession || !result || !result.ok || !settings || !frames.current)
      return;
    const f = frames.current;
    Object.assign(window, {
      __spStudio: {
        slices: () => slices,
        layout: () => result.layout,
        crop: () => result.crop,
        warnings: () => warnings,
        project: () => project,
        size: () => ({ width: activeSession.width, height: activeSession.height }),
        async pdfBase64() {
          const bytes = await exportPdf(
            activeSession,
            f,
            slices,
            result.layout,
            settings.exportPreset,
            pdfFor(settings, result),
            undefined,
            outAnns,
            pageOcr,
          );
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000)
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(bin);
        },
      },
    });
  }, [activeSession, result, settings, slices, warnings, project, outAnns, pageOcr]);

  if (stage.kind === 'error') {
    return (
      <Centered>
        <p role="alert" className="text-red-700 dark:text-red-300">
          {stage.message}
        </p>
      </Centered>
    );
  }
  if (!activeSession || !analysis || !settings || !result) {
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
      return new URL(activeSession.session.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const captured = new Date(activeSession.session.capturedAt).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const dpiReadout = result.ok
    ? (() => {
        const raw = pageDpi(activeSession.dpr, result.layout.s);
        const sc = exportScale(activeSession.dpr, result.layout.s, QUALITY[settings.exportPreset]);
        return { raw, effective: raw * sc };
      })()
    : null;

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
        text={
          result.ok && !result.sheets && fontPx
            ? { fontPx, contentWidth: result.crop.x1 - result.crop.x0 }
            : null
        }
        dpi={dpiReadout}
        sheets={{
          detected: analysis.sheets,
          readings: analysis.readings,
          grid: project.sheetGrid ?? null,
          pages: result.ok && result.sheets ? result.debug.slices.length : 0,
          width: activeSession.width,
          mode: pagesMode(project, settings),
          // The grid set by hand is kept when switching away, so switching back restores it.
          onMode: (pages) => changeProject({ pages }),
          hints: settings.sheetHints,
          onHints: (sheetHints) => updateSettings({ sheetHints }),
          docOriginal: settings.docOriginal,
          original: result.ok ? (result.original ?? null) : null,
          onOriginal: (docOriginal) => updateSettings({ docOriginal }),
          onGrid: (sheetGrid) => changeProject({ sheetGrid, pages: 'grid' }),
          numbers: pageNumbers
            ? { first: pageNumbers.first, last: pageNumbers.last, total: pageNumbers.total }
            : null,
          running: runningLines.map((l) => l.text),
          numberChoice: project.pageNumbers ?? {},
          onNumbers: (pn) => changeProject({ pageNumbers: pn }),
        }}
        estimate={estimate}
        ocr={{
          pages: ocrPages.map((i) => i + 1),
          ready: !!ocrModel?.ready,
          size: ocrModel?.total ?? 0,
          downloading: ocrDownload,
          readCount: ocrReadCount,
          reading: ocrReading,
          error: ocrError,
          onDownload: () => void getOcrModel(),
          onRead: () => void readOcrNow(),
          onCopyText: () => void doCopyOcrText(),
        }}
      />
    ) : view === 'breaks' ? (
      <BreaksPanel
        edits={edits}
        onReset={() => changeProject({ edits: NO_EDITS })}
        locked={result.ok && result.sheets}
        checks={checks}
        page={stripPage}
        onJump={(i) => {
          const activeIdx = selection.activeIndices.indexOf(i + 1);
          setPage(activeIdx >= 0 ? activeIdx : Math.min(Math.max(0, slices.length - 1), i + 1));
        }}
        seams={{
          adjustedPx: analysis.adjustedSeamPx,
          unverified: analysis.unverifiedSeams,
          rawSeams: !!project.rawSeams,
          busy: seamBusy,
          items: analysis.seams,
          onToggleRaw: () => changeProject({ rawSeams: !project.rawSeams }),
          onJumpY: (y) => setStripJumpY({ y, seq: ++jumpSeq.current }),
        }}
      />
    ) : view === 'markup' ? (
      <PageMarkPanel settings={settings} onSettings={updateSettings}>
        <RedactCard
          runs={allRuns}
          slices={slices}
          covered={redactions(annotations)}
          onRedact={redactRects}
          onJumpToRect={jumpToRect}
          ocr={{
            unreadPages: ocrPages.length > 0 && ocrReadCount === null ? ocrPages.length : 0,
            ready: !!ocrModel?.ready,
            reading: !!ocrReading,
            downloading: !!ocrDownload,
            onRead: () => void readOcrNow(),
            onDownload: () => void getOcrModel(),
          }}
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

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return (
    <div className="flex h-screen flex-col bg-neutral-50 text-[13px] text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold" title={activeSession.session.title}>
            {activeSession.session.title || 'Untitled capture'}
          </h1>
          <p className="truncate text-[12px] text-neutral-500">
            {[
              domain,
              captured,
              result.ok
                ? selection.excludedSet.size > 0
                  ? t('{shown} of {total} pages', {
                      shown: slices.length,
                      total: selection.totalSlices,
                    })
                  : t(slices.length === 1 ? '{n} page' : '{n} pages', { n: slices.length })
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div
          role="tablist"
          aria-label={t('Mode')}
          className="flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800"
        >
          {MODES.map(([v, label, Icon, hint]) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={view === v}
              title={t(hint)}
              disabled={!result.ok}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 focus-visible:outline-2 focus-visible:outline-accent ${view === v ? 'bg-white font-medium shadow-sm dark:bg-neutral-700' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'}`}
            >
              <Icon aria-hidden size={15} />
              {t(label)}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center justify-end gap-1.5">
          <div className="flex items-center gap-0.5" role="group" aria-label={t('History')}>
            <button
              type="button"
              data-testid="header-undo"
              aria-label={t('Undo')}
              title={t('Undo (Ctrl+Z)')}
              disabled={!canUndo}
              onClick={doUndo}
              className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Undo2 aria-hidden size={16} />
            </button>
            <button
              type="button"
              data-testid="header-redo"
              aria-label={t('Redo')}
              title={t('Redo (Ctrl+Y)')}
              disabled={!canRedo}
              onClick={doRedo}
              className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Redo2 aria-hidden size={16} />
            </button>
          </div>
          {warningItems.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowWarnings((v) => !v)}
                aria-expanded={showWarnings}
                className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 focus-visible:outline-2 focus-visible:outline-accent dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
              >
                <TriangleAlert aria-hidden size={14} />
                {t(warningItems.length === 1 ? '{n} note' : '{n} notes', {
                  n: warningItems.length,
                })}
              </button>
              {showWarnings && (
                <ul
                  data-testid="warnings"
                  className="absolute right-0 z-20 mt-1 w-96 max-w-[80vw] rounded-md border border-neutral-200 bg-white p-2 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {warningItems.map((w, i) => (
                    <li key={i} className="py-1">
                      {w.page !== undefined ? (
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => {
                            setPage(w.page!);
                            setView('pages');
                            setShowWarnings(false);
                          }}
                        >
                          {w.text}
                        </button>
                      ) : (
                        w.text
                      )}
                      {w.action === 'recapture' && (
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
                          {t('Hide pop-ups and capture again')}
                        </button>
                      )}
                      {w.action === 'toggle-seams' && (
                        <button
                          type="button"
                          disabled={seamBusy}
                          className="mt-1 block rounded-md border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          onClick={() => changeProject({ rawSeams: !project.rawSeams })}
                        >
                          {seamBusy
                            ? t('Updating seam alignment…')
                            : project.rawSeams
                              ? t('Realign seams automatically')
                              : t('Use original offsets')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button
            type="button"
            aria-label={t('Details')}
            aria-pressed={showDetails}
            title={t('Details: every number and how it was calculated (I)')}
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
            onCopyText={() => void doCopyText()}
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
                rawSlices={rawSlices}
                selection={selection}
                page={activePage}
                onSelect={setPage}
                onToggleExclude={toggleExcludePage}
                onMove={movePage}
                onIncludeAll={includeAllPages}
                onResetOrder={resetPageOrder}
                annotations={outAnns}
                filter={settings.pdf.filter}
              />
            )}
            <main className="relative flex min-w-0 flex-1 flex-col">
              {searchOpen && (view === 'pages' || view === 'markup') && (
                <div
                  data-testid="quick-find"
                  role="search"
                  aria-label={t('Find in capture')}
                  className="absolute top-3 right-4 z-30 flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white/95 px-2 py-1 shadow-md dark:border-neutral-700 dark:bg-neutral-900/95"
                >
                  <Search aria-hidden size={14} className="shrink-0 text-neutral-500" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    autoFocus
                    aria-label={t('Find in capture')}
                    placeholder={t('Find in capture')}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSearchIdx(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        closeSearch();
                      } else if (e.key === 'Enter' && searchMatches.length > 0) {
                        e.preventDefault();
                        setSearchIdx((i) =>
                          e.shiftKey
                            ? (i - 1 + searchMatches.length) % searchMatches.length
                            : (i + 1) % searchMatches.length,
                        );
                      }
                    }}
                    className="w-44 bg-transparent text-[12px] outline-none"
                  />
                  {searchQuery.trim() && (
                    <span
                      data-testid="quick-find-count"
                      className="shrink-0 text-[11px] tabular-nums text-neutral-500"
                    >
                      {searchMatches.length > 0
                        ? t('{i} of {n}', { i: activeSearchIdx + 1, n: searchMatches.length })
                        : t('No matches')}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={t('Previous')}
                    title={t('Previous')}
                    disabled={searchMatches.length === 0}
                    onClick={() =>
                      setSearchIdx((i) => (i - 1 + searchMatches.length) % searchMatches.length)
                    }
                    className="rounded p-0.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
                  >
                    <ChevronUp aria-hidden size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={t('Next')}
                    title={t('Next')}
                    disabled={searchMatches.length === 0}
                    onClick={() => setSearchIdx((i) => (i + 1) % searchMatches.length)}
                    className="rounded p-0.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
                  >
                    <ChevronDown aria-hidden size={15} />
                  </button>
                  {searchMatches.length > 0 && (
                    <button
                      type="button"
                      data-testid="quick-find-blur-all"
                      onClick={() => {
                        const covered = redactions(annotations);
                        const uncovered = searchMatches
                          .map((m) => m.rect)
                          .filter((r) => !isRectCovered(r, covered));
                        setView('markup');
                        if (uncovered.length > 0) {
                          redactRects(uncovered, 'blur');
                          setToast(t('Blurred {n} matches', { n: uncovered.length }));
                        } else {
                          setToast(t('All matches are already hidden.'));
                        }
                      }}
                      className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      {t('Blur all')}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t('Close')}
                    title={t('Close')}
                    onClick={closeSearch}
                    className="rounded p-0.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <X aria-hidden size={14} />
                  </button>
                </div>
              )}
              <div className="absolute right-4 bottom-4 z-20">
                <ZoomControl
                  zoom={zoom}
                  effective={effective}
                  onZoom={changeZoom}
                  pageFit={view === 'pages'}
                />
              </div>
              {view === 'pages' ? (
                <PagesView
                  watermark={settings.pdf.watermark}
                  filter={settings.pdf.filter}
                  session={activeSession}
                  frames={frames.current!}
                  analysis={analysis}
                  slices={slices}
                  layout={result.layout}
                  page={activePage}
                  onSelect={setPage}
                  annotations={outAnns}
                  zoom={zoom}
                  onZoom={changeZoom}
                  onEffective={setEffective}
                  highlight={highlight}
                />
              ) : view === 'markup' ? (
                <>
                  <MarkupToolbar {...markup} />
                  <AnnotateView
                    session={activeSession}
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
                    highlight={highlight}
                  />
                </>
              ) : (
                <StripView
                  session={activeSession}
                  frames={frames.current!}
                  analysis={analysis}
                  debug={result.debug}
                  crop={result.sheets ? { x0: 0, x1: activeSession.width } : result.crop}
                  edits={edits}
                  onEdits={(next) => changeProject({ edits: next })}
                  page={stripPage}
                  locked={result.sheets}
                  checks={checks}
                  zoom={zoom}
                  onZoom={changeZoom}
                  onEffective={setEffective}
                  jumpY={stripJumpY}
                  sheetGrid={
                    result.sheets && editGrid
                      ? {
                          grid: editGrid,
                          onGrid: (sheetGrid) => changeProject({ sheetGrid, pages: 'grid' }),
                        }
                      : undefined
                  }
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

      {(busy || seamBusy || toast) && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-neutral-900 px-3 py-2 text-white shadow-sm dark:bg-neutral-100 dark:text-neutral-900"
          onClick={() => setToast(null)}
        >
          {busy ?? (seamBusy ? t('Updating seam alignment…') : toast)}
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
