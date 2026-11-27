import {
  CAPTURE_PACING,
  Pacer,
  blockedReason,
  narrowWindowTo,
  type CaptureLimits,
  type Rect,
  type Region,
} from '@screenscroll/core';
import {
  db,
  deleteCapture,
  deleteOlderThan,
  summarizeFrames,
  type SessionRecord,
} from '@/shared/db';
import {
  TAB_HIDDEN,
  type BatchCancel,
  type CaptureControl,
  type CaptureDone,
  type CaptureMode,
  type CapturePause,
  type CaptureResume,
  type GrabFrame,
  type GrabResult,
  type PageNotice,
  type Recapture,
  type ToBackground,
} from '@/shared/messages';
import {
  BATCH_KEY,
  cancelRemainingItems,
  type BatchItem,
  type BatchStart,
  type BatchState,
} from '@/shared/batch';
import { actionApi, hasDebugger, isFileAccessAllowed } from '@/shared/capabilities';
import { dataUrlToBlob, pngSize } from '@/shared/png';
import { resolveLang } from '@/shared/i18n';
import { loadSettings, RESOLUTION_SCALE, SPEED_TIMING } from '@/shared/settings';

export default defineBackground(() => {
  let pacer = new Pacer();
  // Captures rendered at a higher pixel density through the debugger (Settings → Sharpness).
  const sharp = new Map<string, { tabId: number; scale: number; failed: boolean }>();
  // Captures taken in the background (Settings → Scrolling: in background): the debugger
  // pictures each region of the page's layout, so the page itself never scrolls.
  const quietTabs = new Map<string, { tabId: number; scale: number }>();
  // Running captures whose IndexedDB record has been read into memory in this worker instance.
  const known = new Set<string>();
  const windowOf = new Map<string, number>();
  const waiters = new Map<string, (done: CaptureDone) => void>();
  // Captures of a batch: saved without opening a Studio tab each.
  const silent = new Set<string>();
  // Batch cancellation state for the currently running batch (if any).
  let batchCancelled = false;
  let batchCurrentTabId: number | null = null;
  let batchCancelWake: (() => void) | null = null;
  // e2e only: finished sessions (a test may wait after the capture already ended) and an
  // injected grab failure, to exercise the error path.
  const finished = new Map<string, CaptureDone>();
  let failGrabAt: number | null = null;

  async function startCapture(
    tab: chrome.tabs.Tab,
    mode: CaptureMode,
    opts: CaptureOptions = {},
  ): Promise<string> {
    const blocked = blockedReason(tab.url, await isFileAccessAllowed());
    if (blocked || tab.id === undefined) throw new Error(blocked?.message ?? 'No tab to capture.');
    const id = crypto.randomUUID();
    const { silent: isSilent, ...startOpts } = opts;
    known.add(id);
    windowOf.set(id, tab.windowId);
    if (isSilent) silent.add(id);
    await (
      await db()
    ).put('sessions', {
      id,
      url: tab.url ?? '',
      title: tab.title ?? '',
      capturedAt: new Date().toISOString(),
      status: 'capturing',
      docWidth: 0,
      docHeight: 0,
      frameCount: 0,
      warnings: [],
      tabId: tab.id,
      windowId: tab.windowId,
      mode,
      ...(startOpts.region ? { region: startOpts.region } : {}),
      ...(isSilent ? { run: { silent: true } } : {}),
    });
    const settings = await loadSettings();
    const timing = SPEED_TIMING[settings.capture.speed];
    pacer = new Pacer({ ...CAPTURE_PACING, minIntervalMs: timing.intervalMs });
    const warnings: string[] = [];
    const scale = RESOLUTION_SCALE[settings.capture.resolution];
    let quiet = false;
    let sharpOk = false;
    if (settings.capture.quiet && mode === 'full' && !startOpts.region) {
      const why = await startQuiet(id, tab.id, scale);
      if (why) warnings.push(why);
      else quiet = true;
    }
    // In the background the debugger renders at the chosen density itself.
    if (scale > 1 && !quiet) {
      const why = await startSharp(id, tab.id, scale);
      if (why) warnings.push(why);
      else sharpOk = true;
    }
    if (settings.capture.width && (mode === 'full' || mode === 'visible')) {
      try {
        const why = await narrowWindow(id, tab.id, tab.windowId, settings.capture.width);
        if (why) warnings.push(why);
      } catch (e) {
        await restoreWindow(id);
        warnings.push(
          `The page width could not be set (${e instanceof Error ? e.message : String(e)}); captured as it was.`,
        );
      }
    }
    const run: NonNullable<SessionRecord['run']> = {
      ...(isSilent ? { silent: true } : {}),
      ...(quiet ? { quietScale: scale } : {}),
      ...(sharpOk ? { sharpScale: scale } : {}),
    };
    if (warnings.length || Object.keys(run).length) {
      const d = await db();
      const rec = await d.get('sessions', id);
      if (rec)
        await d.put('sessions', {
          ...rec,
          warnings,
          ...(Object.keys(run).length ? { run } : {}),
        });
    }
    try {
      await showCapturing(tab.id);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/capture.js'] });
      await chrome.tabs.sendMessage(tab.id, {
        type: 'sp:start',
        sessionId: id,
        mode,
        startAt: settings.capture.start,
        timing,
        lang: resolveLang(settings.language),
        quiet,
        ...startOpts,
      });
    } catch (e) {
      await restoreWindow(id);
      await stopSharp(id);
      await stopQuiet(id);
      known.delete(id);
      windowOf.delete(id);
      silent.delete(id);
      throw e;
    }
    return id;
  }

  /** The page's layout width in CSS px. */
  async function viewportWidth(tabId: number): Promise<number> {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.clientWidth,
    });
    return r?.result as number;
  }

  /**
   * Settings → Page width (CAPTURE §8): narrows the window so the page lays itself out at
   * `target` CSS px. The window as it was is kept in the session record first, so it is put
   * back even after a service-worker restart. Returns a warning when the width isn't reached.
   */
  async function narrowWindow(
    sessionId: string,
    tabId: number,
    windowId: number,
    target: number,
  ): Promise<string | null> {
    let win = await chrome.windows.get(windowId);
    const zoom = await chrome.tabs.getZoom(tabId);
    if (
      narrowWindowTo(target, { width: win.width ?? 0 }, await viewportWidth(tabId), zoom) === null
    )
      return null;
    const d = await db();
    const rec = await d.get('sessions', sessionId);
    if (!rec) return null;
    await d.put('sessions', {
      ...rec,
      window: {
        id: windowId,
        state: win.state ?? 'normal',
        left: win.left,
        top: win.top,
        width: win.width,
        height: win.height,
      },
    });
    // A maximised or full-screen window has no width of its own to change.
    if (win.state !== 'normal') {
      await chrome.windows.update(windowId, { state: 'normal' });
      win = await chrome.windows.get(windowId);
    }
    const width = narrowWindowTo(
      target,
      { width: win.width ?? 0 },
      await viewportWidth(tabId),
      zoom,
    );
    if (width !== null) await chrome.windows.update(windowId, { width });
    // Wait for the reflow, then a moment for layout-dependent content (images, lazy parts).
    let got = await viewportWidth(tabId);
    for (let t = 0; t < 20 && Math.abs(got - target) > 1; t++) {
      await new Promise((r) => setTimeout(r, 100));
      got = await viewportWidth(tabId);
    }
    await new Promise((r) => setTimeout(r, 400));
    return Math.abs(got - target) > 2
      ? `The page could only be laid out at ${got} px wide (Page width ${target} px): the window can't be made narrower.`
      : null;
  }

  /** Puts a narrowed window back as it was; harmless when there is nothing to do. */
  async function restoreWindow(sessionId: string): Promise<void> {
    const d = await db();
    const rec = await d.get('sessions', sessionId);
    const w = rec?.window;
    if (!rec || !w) return;
    await d.put('sessions', { ...rec, window: undefined });
    await chrome.windows
      .update(
        w.id,
        w.state === 'normal'
          ? { left: w.left, top: w.top, width: w.width, height: w.height }
          : { state: w.state as chrome.windows.WindowState },
      )
      .catch(() => undefined);
  }

  /** Restores in-memory capture state from IndexedDB if the service worker restarted mid-capture. */
  async function hydrate(sessionId: string): Promise<void> {
    if (known.has(sessionId)) return;
    const s = await (await db()).get('sessions', sessionId);
    if (!s) return;
    known.add(sessionId);
    windowOf.set(sessionId, s.windowId);
    if (s.run?.silent) silent.add(sessionId);
    if (s.run?.quietScale) quietTabs.set(sessionId, { tabId: s.tabId, scale: s.run.quietScale });
    if (s.run?.sharpScale)
      sharp.set(sessionId, { tabId: s.tabId, scale: s.run.sharpScale, failed: false });
  }

  /**
   * Renders the tab at `scale` device pixels per CSS px (layout unchanged) through the
   * debugger. Returns a warning when that isn't possible; the capture then uses the screen's
   * own resolution.
   */
  async function startSharp(
    sessionId: string,
    tabId: number,
    scale: number,
  ): Promise<string | null> {
    if (!hasDebugger())
      return 'Sharp capture requires Chrome or Edge; captured at screen resolution.';
    if (!(await chrome.permissions.contains({ permissions: ['debugger'] })))
      return 'Sharp capture needs permission (choose 2× or 3× in the panel or Settings to allow it); captured at screen resolution.';
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
        width: 0,
        height: 0,
        deviceScaleFactor: scale,
        mobile: false,
      });
      sharp.set(sessionId, { tabId, scale, failed: false });
      return null;
    } catch (e) {
      await chrome.debugger.detach({ tabId }).catch(() => undefined);
      return `Sharp capture was not possible (${e instanceof Error ? e.message : String(e)}); captured at screen resolution.`;
    }
  }

  async function startQuiet(
    sessionId: string,
    tabId: number,
    scale: number,
  ): Promise<string | null> {
    if (!hasDebugger())
      return 'Capturing in the background requires Chrome or Edge; captured by scrolling instead.';
    if (!(await chrome.permissions.contains({ permissions: ['debugger'] })))
      return 'Capturing in the background needs permission (choose “In background” in the panel again to allow it); captured by scrolling instead.';
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      quietTabs.set(sessionId, { tabId, scale });
      return null;
    } catch (e) {
      return `Capturing in the background was not possible (${e instanceof Error ? e.message : String(e)}); captured by scrolling instead.`;
    }
  }

  async function stopQuiet(sessionId: string, fallbackTabId?: number): Promise<void> {
    const q = quietTabs.get(sessionId);
    quietTabs.delete(sessionId);
    const tabId = q?.tabId ?? fallbackTabId;
    if (tabId === undefined || !hasDebugger()) return;
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }

  /**
   * When a background capture falls back to on-screen scrolling (for example, an inner scroll
   * area that could not be expanded), detach the quiet debugger session and engage Sharp
   * capture if 2×/3× Sharpness was requested.
   */
  async function quietFallback(sessionId: string): Promise<{ warning?: string }> {
    await hydrate(sessionId);
    const q = quietTabs.get(sessionId);
    if (!q) return {};
    await stopQuiet(sessionId, q.tabId);
    let sharpScale: number | undefined;
    let warning: string | undefined;
    if (q.scale > 1) {
      const why = await startSharp(sessionId, q.tabId, q.scale);
      if (why) warning = why;
      else sharpScale = q.scale;
    }
    const d = await db();
    const rec = await d.get('sessions', sessionId);
    if (rec) {
      const nextRun: NonNullable<SessionRecord['run']> = {
        ...(rec.run?.silent ? { silent: true } : {}),
        ...(sharpScale ? { sharpScale } : {}),
      };
      await d.put('sessions', {
        ...rec,
        run: Object.keys(nextRun).length ? nextRun : undefined,
      });
    }
    return warning ? { warning } : {};
  }

  /** One region of the page's layout, pictured without scrolling the page. */
  async function grabQuiet(msg: GrabFrame & { clip: Rect }): Promise<GrabResult> {
    await hydrate(msg.sessionId);
    const q = quietTabs.get(msg.sessionId);
    if (!q || !hasDebugger())
      return { ok: false, error: 'Background capture is not running for this tab.' };
    const shot = () =>
      chrome.debugger.sendCommand({ tabId: q.tabId }, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { ...msg.clip, scale: (msg.dpr ?? 1) * q.scale },
      }) as Promise<{ data: string }>;
    try {
      const r = await shot().catch(async (err: unknown) => {
        if (!/not attached/i.test(String(err))) throw err;
        await chrome.debugger.attach({ tabId: q.tabId }, '1.3');
        return shot();
      });
      const blob = dataUrlToBlob(`data:image/png;base64,${r.data}`);
      const size = await pngSize(blob);
      await (
        await db()
      ).put('frames', {
        sessionId: msg.sessionId,
        index: msg.index,
        docY: msg.docY,
        crop: { x: 0, y: 0, width: msg.clip.width, height: msg.clip.height },
        dpr: size.width / msg.clip.width,
        imageWidth: size.width,
        imageHeight: size.height,
        blob,
        hints: msg.hints,
        hintsMs: msg.hintsMs,
      });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: `The background capture stopped (${e instanceof Error ? e.message : String(e)}). If you closed the debugging bar, capture again or choose “On screen”.`,
      };
    }
  }

  async function stopSharp(sessionId: string, fallbackTabId?: number): Promise<void> {
    const s = sharp.get(sessionId);
    sharp.delete(sessionId);
    const tabId = s?.tabId ?? fallbackTabId;
    if (tabId === undefined || !hasDebugger()) return;
    await chrome.debugger
      .sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride')
      .catch(() => undefined);
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }

  /**
   * While a capture runs, the icon says so, and its tooltip says how to stop: the user may
   * have started it by accident from a menu or a key.
   */
  async function showCapturing(tabId: number): Promise<void> {
    const action = actionApi();
    if (!action) return;
    await action.setBadgeBackgroundColor({ tabId, color: '#0e7c7b' });
    await action.setBadgeText({ tabId, text: 'REC' });
    await action.setTitle({
      tabId,
      title:
        'ScreenScroll is capturing this tab. Press Esc on the page to cancel, or click here to stop.',
    });
  }

  async function clearCapturing(tabId: number | undefined): Promise<void> {
    const action = actionApi();
    if (tabId === undefined || !action) return;
    const text = await action.getBadgeText({ tabId }).catch(() => '');
    if (text !== 'REC' && text !== 'WAIT') return;
    await action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    await action.setTitle({ tabId, title: ICON_TITLE }).catch(() => undefined);
  }

  /** The capturing tab must be the one in front: captureVisibleTab pictures that one. */
  async function inFront(tabId: number | undefined): Promise<boolean> {
    if (tabId === undefined) return true;
    const t = await chrome.tabs.get(tabId).catch(() => null);
    return !!t?.active;
  }

  async function grab(msg: GrabFrame, tabId?: number): Promise<GrabResult> {
    if (msg.clip) return grabQuiet(msg as GrabFrame & { clip: Rect });
    await hydrate(msg.sessionId);
    if (quietTabs.has(msg.sessionId)) await quietFallback(msg.sessionId);
    const windowId = windowOf.get(msg.sessionId);
    if (windowId === undefined) return { ok: false, error: 'Unknown capture session.' };
    if (__SP_E2E__ && failGrabAt === msg.index) {
      failGrabAt = null;
      return { ok: false, error: 'Injected test failure' };
    }
    const action = actionApi();
    if (!(await inFront(tabId))) {
      // The page can't show this while its tab is hidden; the icon can.
      if (tabId !== undefined && action) {
        await action.setBadgeText({ tabId, text: 'WAIT' }).catch(() => undefined);
        await action
          .setTitle({
            tabId,
            title: 'ScreenScroll paused: the capture goes on when you return to its tab.',
          })
          .catch(() => undefined);
      }
      return { ok: false, error: TAB_HIDDEN };
    }
    if (tabId !== undefined && action && (await action.getBadgeText({ tabId })) === 'WAIT')
      await showCapturing(tabId);
    try {
      const hi = sharp.get(msg.sessionId);
      const sharpShot = async (h: { tabId: number; scale: number }) => {
        const take = () =>
          chrome.debugger
            .sendCommand({ tabId: h.tabId }, 'Page.captureScreenshot', { format: 'png' })
            .then((r) => `data:image/png;base64,${(r as { data: string }).data}`);
        return take().catch(async (err: unknown) => {
          if (!/not attached/i.test(String(err))) throw err;
          await chrome.debugger.attach({ tabId: h.tabId }, '1.3');
          await chrome.debugger.sendCommand(
            { tabId: h.tabId },
            'Emulation.setDeviceMetricsOverride',
            {
              width: 0,
              height: 0,
              deviceScaleFactor: h.scale,
              mobile: false,
            },
          );
          return take();
        });
      };
      const dataUrl =
        hi && !hi.failed
          ? await sharpShot(hi).catch(async () => {
              // The user closed the debugging bar: carry on at screen resolution.
              hi.failed = true;
              return pacer.run(() => chrome.tabs.captureVisibleTab(windowId, { format: 'png' }));
            })
          : await pacer.run(async () => {
              // The pacer may have waited; the user can switch tabs meanwhile.
              if (!(await inFront(tabId))) throw new Error(TAB_HIDDEN);
              return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
            });
      const blob = dataUrlToBlob(dataUrl);
      const size = await pngSize(blob);
      // Real DPR from the pixels: browser zoom changes it (CAPTURE §9).
      const dpr = size.width / msg.viewportWidth;
      await (
        await db()
      ).put('frames', {
        sessionId: msg.sessionId,
        index: msg.index,
        docY: msg.docY,
        crop: msg.crop,
        dpr,
        imageWidth: size.width,
        imageHeight: size.height,
        blob,
        hints: msg.hints,
        hintsMs: msg.hintsMs,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function finish(msg: CaptureDone): Promise<void> {
    await hydrate(msg.sessionId);
    const hi = sharp.get(msg.sessionId);
    if (hi?.failed)
      msg.warnings.push(
        'Sharp capture stopped part-way (the debugging bar was closed); the rest is at screen resolution.',
      );
    const d = await db();
    const pre = await d.get('sessions', msg.sessionId);
    const wasQuiet = !!pre?.run?.quietScale;
    await stopSharp(msg.sessionId, pre?.run?.sharpScale ? pre.tabId : undefined);
    await stopQuiet(msg.sessionId, pre?.run?.quietScale ? pre.tabId : undefined);
    await restoreWindow(msg.sessionId);
    const session = await d.get('sessions', msg.sessionId);
    await clearCapturing(session?.tabId);
    known.delete(msg.sessionId);
    windowOf.delete(msg.sessionId);
    const isSilent = silent.delete(msg.sessionId) || !!session?.run?.silent;
    if (msg.status === 'cancelled') {
      // Cancel (Esc) means "I didn't want this": nothing is kept and nothing opens. "Stop
      // here" is the way to keep a partial capture.
      await deleteCapture(msg.sessionId);
      if (__SP_E2E__) finished.set(msg.sessionId, msg);
      waiters.get(msg.sessionId)?.(msg);
      waiters.delete(msg.sessionId);
      return;
    }
    const frames = (await d.getAllFromIndex('frames', 'bySession', msg.sessionId)).sort(
      (a, b) => a.index - b.index,
    );
    const frameCount = frames.length;
    if (session) {
      await d.put('sessions', {
        ...session,
        ...(msg.title ? { title: msg.title } : {}),
        ...(msg.region ? { region: msg.region } : {}),
        status: msg.status,
        docWidth: msg.docWidth,
        docHeight: msg.docHeight,
        frameCount,
        ...summarizeFrames(frames, session.ocrRuns),
        warnings: [...session.warnings, ...msg.warnings],
        run: undefined,
      });
    }
    // Auto-clean (Saved captures setting); never touches the capture that just finished.
    const { keepDays } = await loadSettings();
    if (keepDays) await deleteOlderThan(keepDays).catch(() => 0);
    // Marks drawn in area mode become the Studio project's annotations.
    if (msg.annotations?.length && session) {
      const fresh = await d.get('sessions', msg.sessionId);
      if (fresh)
        await d.put('sessions', {
          ...fresh,
          project: { annotations: msg.annotations, crop: null },
        });
    }
    // UI §7: whatever was captured opens, even after an error; the Studio says why.
    if (frameCount > 0 && !isSilent)
      await openStudio(msg.sessionId, msg.output, session?.tabId, wasQuiet);
    if (__SP_E2E__) finished.set(msg.sessionId, msg);
    waiters.get(msg.sessionId)?.(msg);
    waiters.delete(msg.sessionId);
  }

  async function openStudio(
    sessionId: string,
    output?: CaptureDone['output'],
    openerTabId?: number,
    wasQuiet = false,
  ): Promise<void> {
    const { afterCapture } = await loadSettings();
    const mode = output ?? (afterCapture === 'pdf' ? 'pdf' : 'studio');
    const url = chrome.runtime.getURL(
      `/studio.html?session=${encodeURIComponent(sessionId)}${mode === 'studio' ? '' : `&auto=${mode}`}`,
    );
    // "Save PDF directly" works in a background tab that closes itself when done. Copying
    // needs a focused page, so that tab comes to the front and closes back to the page.
    // A background (quiet) capture whose tab is no longer active opens Studio in the
    // background so it never steals focus from what the user switched to.
    const wasActive = openerTabId !== undefined && (await inFront(openerTabId));
    const opener = wasActive ? openerTabId : undefined;
    const active = mode !== 'pdf' && (!wasQuiet || wasActive);
    await chrome.tabs.create({ url, active, openerTabId: opener });
  }

  /** Resolves when a tab has finished loading, or after `ms` (then `false`). */
  function loaded(tabId: number, ms = 30_000): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        if (batchCancelWake === abort) batchCancelWake = null;
        resolve(ok);
      };
      const abort = () => done(false);
      batchCancelWake = abort;
      const onUpdated = (id: number, info: { status?: string }) => {
        if (id === tabId && info.status === 'complete') done(true);
      };
      const timer = setTimeout(() => done(false), ms);
      chrome.tabs.onUpdated.addListener(onUpdated);
      void chrome.tabs
        .get(tabId)
        .then((t) => t.status === 'complete' && done(true))
        .catch(() => done(false));
    });
  }

  /** Waits for a capture to end; a capture that never reports back fails after `ms`. */
  function ended(sessionId: string, ms = 10 * 60_000): Promise<CaptureDone | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(sessionId);
        resolve(null);
      }, ms);
      waiters.set(sessionId, (d) => {
        clearTimeout(timer);
        resolve(d);
      });
    });
  }

  /** Cancels a running batch: aborts the in-flight item and skips remaining ones. */
  function cancelBatch(): void {
    batchCancelled = true;
    batchCancelWake?.();
    batchCancelWake = null;
    if (batchCurrentTabId !== null) {
      void chrome.tabs
        .sendMessage(batchCurrentTabId, { type: 'sp:control', action: 'cancel' } satisfies CaptureControl)
        .catch(() => undefined);
    }
  }

  /**
   * Batch (ROADMAP M5): each target in turn is brought to the front (captureVisibleTab
   * pictures the visible tab), captured as a full page and saved without a Studio tab.
   * Addresses open in a new tab that is closed afterwards. Pages that can't be captured are
   * skipped with the reason; progress is kept in session storage for the batch page.
   */
  async function runBatch(m: BatchStart): Promise<void> {
    batchCancelled = false;
    batchCurrentTabId = null;
    const fileAccess = await isFileAccessAllowed();
    const items: BatchItem[] = await Promise.all(
      m.targets.map(async (t) => {
        if (t.kind === 'url')
          return { label: t.url, url: t.url, status: 'waiting' as const, target: t };
        const tab = await chrome.tabs.get(t.tabId).catch(() => null);
        return {
          label: tab?.title || tab?.url || 'Closed tab',
          url: tab?.url ?? '',
          status: 'waiting' as const,
          target: t,
        };
      }),
    );
    const state: BatchState = { running: true, items };
    const save = () => chrome.storage.session?.set({ [BATCH_KEY]: state }) ?? Promise.resolve();
    await save();
    for (const [i, t] of m.targets.entries()) {
      if (batchCancelled) break;
      const item = items[i]!;
      let opened: number | null = null;
      try {
        let tab: chrome.tabs.Tab | null;
        if (t.kind === 'url') {
          tab = await chrome.tabs.create({ url: t.url, windowId: m.windowId, active: true });
          opened = tab.id ?? null;
        } else {
          tab = await chrome.tabs.get(t.tabId).catch(() => null);
          if (!tab?.id) throw new Skip('The tab was closed.');
          const blocked = blockedReason(tab.url, fileAccess);
          if (blocked) throw new Skip(blocked.message);
          tab = (await chrome.tabs.update(tab.id, { active: true })) ?? null;
        }
        if (!tab?.id) throw new Error('No tab to capture.');
        batchCurrentTabId = tab.id;
        item.status = 'capturing';
        await save();
        const ready = await loaded(tab.id);
        if (batchCancelled) throw new Skip('Cancelled.');
        // Settle after the page reports loaded (late layout, web fonts).
        await new Promise<void>((r) => {
          const timer = setTimeout(() => {
            if (batchCancelWake === done) batchCancelWake = null;
            r();
          }, 500);
          const done = () => {
            clearTimeout(timer);
            batchCancelWake = null;
            r();
          };
          batchCancelWake = done;
        });
        if (batchCancelled) throw new Skip('Cancelled.');
        tab = await chrome.tabs.get(tab.id);
        item.label = tab.title || item.label;
        item.url = tab.url ?? item.url;
        const blocked = blockedReason(tab.url, fileAccess);
        if (blocked) throw new Skip(blocked.message);
        const id = await startCapture(tab, 'full', { silent: true });
        if (batchCancelled && tab.id !== undefined) {
          void chrome.tabs
            .sendMessage(tab.id, { type: 'sp:control', action: 'cancel' } satisfies CaptureControl)
            .catch(() => undefined);
        }
        const done = await ended(id);
        if (!done) throw new Error('The capture did not finish within 10 minutes.');
        if (done.status === 'complete') {
          item.sessionId = id;
          item.status = 'done';
          const notes = [...done.warnings];
          if (!ready) notes.unshift('The page was still loading after 30 s.');
          if (notes.length) item.reason = notes.join(' ');
        } else if (batchCancelled) {
          item.status = 'skipped';
          item.reason = 'Cancelled.';
        } else {
          item.sessionId = id;
          item.status = 'failed';
          item.reason = done.warnings.at(-1) ?? 'The capture was cancelled.';
        }
      } catch (e) {
        item.status = e instanceof Skip ? 'skipped' : 'failed';
        item.reason = e instanceof Error ? e.message : String(e);
      } finally {
        batchCurrentTabId = null;
        if (opened !== null) await chrome.tabs.remove(opened).catch(() => undefined);
      }
      await save();
    }
    if (batchCancelled) {
      state.items = cancelRemainingItems(state.items, 'Cancelled.');
    }
    state.running = false;
    await save();
    await chrome.tabs.update(m.homeTabId, { active: true }).catch(() => undefined);
  }

  /**
   * Overlay killer (CAPTURE §4): the same tab, captured again the same way with pop-ups
   * hidden. Only while the tab still shows the captured address: anything else would be a
   * different page.
   */
  async function recapture(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const s = await (await db()).get('sessions', sessionId);
    const tab = s && (await chrome.tabs.get(s.tabId).catch(() => null));
    if (!s || !tab || tab.url !== s.url)
      return {
        ok: false,
        error: 'The captured page is no longer open in its tab. Open it again and capture it.',
      };
    await chrome.tabs.update(tab.id!, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    try {
      await startCapture(tab, s.mode ?? 'full', {
        hideOverlays: true,
        ...(s.region ? { region: s.region } : {}),
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** The capture running in the active tab, if any (for the toolbar panel). */
  async function running(): Promise<{ sessionId: string; tabId: number; paused: boolean } | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    const d = await db();
    const stale = (await d.getAll('sessions')).filter(
      (x) => x.status === 'capturing' && x.tabId === tab.id,
    );
    if (!stale.length) return null;
    // A record says "capturing", but only the page knows: after a reload, a crash or a
    // browser restart (tab ids are reused) the record stays behind, and trusting it would
    // lock the panel's capture buttons on this tab for good.
    const status = await chrome.tabs
      .sendMessage(tab.id, { type: 'sp:status' })
      .then((r: { sessionId?: string | null; paused?: boolean } | undefined) => r ?? null)
      .catch(() => null);
    const live = status?.sessionId ?? null;
    for (const s of stale) {
      if (s.id === live) continue;
      await d.put('sessions', {
        ...s,
        status: 'error',
        run: undefined,
        warnings: [
          ...s.warnings,
          'The capture was interrupted (the page or the extension was reloaded, or the browser closed) and stopped here.',
        ],
      });
      await stopSharp(s.id, s.run?.sharpScale ? s.tabId : undefined);
      await stopQuiet(s.id, s.run?.quietScale ? s.tabId : undefined);
      await restoreWindow(s.id);
      known.delete(s.id);
      windowOf.delete(s.id);
      silent.delete(s.id);
    }
    if (live && stale.some((s) => s.id === live))
      return { sessionId: live, tabId: tab.id, paused: !!status?.paused };
    await clearCapturing(tab.id);
    return null;
  }

  // A tab closed mid-capture can't report back: put a narrowed window back here.
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const all = await (await db()).getAll('sessions');
      for (const s of all) {
        if (s.tabId !== tabId) continue;
        if (s.window) await restoreWindow(s.id);
        if (s.run?.sharpScale || s.run?.quietScale) {
          await stopSharp(s.id);
          await stopQuiet(s.id);
        }
        known.delete(s.id);
        windowOf.delete(s.id);
        silent.delete(s.id);
      }
    })();
  });

  chrome.runtime.onMessage.addListener(
    (
      msg:
        | ToBackground
        | PopupCapture
        | CaptureControl
        | CapturePause
        | CaptureResume
        | BatchCancel
        | PageNotice
        | BatchStart
        | Recapture
        | { type: 'sp:running' },
      _sender,
      reply,
    ) => {
      if (msg.type === 'sp:grab') {
        void grab(msg, _sender.tab?.id).then(reply);
        return true;
      }
      if (msg.type === 'sp:quiet-fallback') {
        void quietFallback(msg.sessionId).then(reply);
        return true;
      }
      if (msg.type === 'sp:batch-start') {
        void runBatch(msg);
        reply({ ok: true });
        return false;
      }
      if (msg.type === 'sp:batch-cancel') {
        cancelBatch();
        reply({ ok: true });
        return false;
      }
      if (msg.type === 'sp:notice') {
        if (msg.tabId !== undefined)
          void chrome.tabs
            .sendMessage(msg.tabId, { type: 'sp:notice', text: msg.text })
            .catch(() => undefined);
        return false;
      }
      if (msg.type === 'sp:recapture') {
        void recapture(msg.sessionId).then(reply);
        return true;
      }
      if (msg.type === 'sp:running') {
        void running().then(reply);
        return true;
      }
      if (msg.type === 'sp:control') {
        void running().then(async (r) => {
          if (r) await chrome.tabs.sendMessage(r.tabId, msg).catch(() => undefined);
          reply({ ok: !!r });
        });
        return true;
      }
      if (msg.type === 'sp:pause' || msg.type === 'sp:resume') {
        void (async () => {
          let targetTabId: number | undefined;
          const r = await running();
          if (r && (!msg.sessionId || r.sessionId === msg.sessionId)) {
            targetTabId = r.tabId;
          } else if (msg.sessionId) {
            const s = await (await db()).get('sessions', msg.sessionId);
            if (s && s.status === 'capturing') targetTabId = s.tabId;
          }
          if (targetTabId === undefined) return reply({ ok: false });
          await chrome.tabs.sendMessage(targetTabId, msg).catch(() => undefined);
          if (msg.type === 'sp:pause') {
            await actionApi()?.setBadgeText({ tabId: targetTabId, text: 'WAIT' }).catch(() => undefined);
          } else {
            await showCapturing(targetTabId).catch(() => undefined);
          }
          reply({ ok: true });
        })();
        return true;
      }
      if (msg.type === 'sp:popup-capture') {
        void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
          if (!tab) return reply({ ok: false, error: 'No tab to capture.' });
          try {
            await startCapture(tab, msg.mode, { delayMs: msg.delayMs });
            reply({ ok: true });
          } catch (e) {
            reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        });
        return true;
      }
      if (msg.type === 'sp:done') {
        void finish(msg).then(() => reply({ ok: true }));
        return true;
      }
      return false;
    },
  );

  /**
   * UI §1: the toolbar icon opens a small panel (popup/) with every mode and the few settings
   * worth having at hand. The page menu has the modes too. A menu entry grants activeTab,
   * like the toolbar button.
   */
  const PAGE_MENU: Array<{ id: string; title: string; mode: CaptureMode }> = [
    { id: 'sp-full', title: 'Capture full page', mode: 'full' },
    { id: 'sp-visible', title: 'Capture visible area', mode: 'visible' },
    { id: 'sp-selection', title: 'Capture a selection', mode: 'selection' },
    { id: 'sp-lines', title: 'Capture from line to line', mode: 'lines' },
    { id: 'sp-element', title: 'Capture an element', mode: 'element' },
    { id: 'sp-pick-scroller', title: 'Capture a scroll area', mode: 'pick-scroller' },
    { id: 'sp-reader', title: 'Capture clean page', mode: 'reader' },
  ];

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      for (const m of PAGE_MENU)
        chrome.contextMenus.create({ id: m.id, title: m.title, contexts: ['page'] });
    });
  });

  async function onMenu(
    info: { menuItemId: string | number },
    tab?: chrome.tabs.Tab,
  ): Promise<string | null> {
    const item = PAGE_MENU.find((m) => m.id === info.menuItemId);
    return item && tab ? capture(tab, item.mode) : null;
  }
  chrome.contextMenus.onClicked.addListener((info, tab) => void onMenu(info, tab));

  const COMMANDS: Record<string, CaptureMode> = {
    'capture-full': 'full',
    'capture-visible': 'visible',
    'capture-selection': 'selection',
    'capture-element': 'element',
  };
  chrome.commands.onCommand.addListener((command, tab) => {
    const mode = COMMANDS[command];
    if (mode && tab) void capture(tab, mode);
  });

  /**
   * Starts a capture from a click, a menu or a key. With no popup to show an error in, a
   * page that can't be captured gets a red "!" on the icon whose tooltip says why (never
   * fail silently); the next capture on that tab clears it.
   */
  /** Same text as the manifest's default_title. */
  const ICON_TITLE = 'ScreenScroll';

  async function capture(
    tab: chrome.tabs.Tab,
    mode: CaptureMode,
    opts: CaptureOptions = {},
  ): Promise<string | null> {
    const tabId = tab.id;
    const action = actionApi();
    try {
      if (tabId !== undefined && action) {
        await action.setBadgeText({ tabId, text: '' });
        await action.setTitle({ tabId, title: ICON_TITLE });
      }
      return await startCapture(tab, mode, opts);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (tabId !== undefined && action) {
        await action.setBadgeBackgroundColor({ tabId, color: '#b3261e' });
        await action.setBadgeText({ tabId, text: '!' });
        await action.setTitle({ tabId, title: `ScreenScroll: ${message}` });
      }
      return null;
    }
  }

  if (__SP_E2E__) {
    // Test hook: Playwright cannot click the toolbar button, so it calls this directly.
    Object.assign(globalThis, {
      __spTest: {
        async start(
          tabId: number,
          mode: CaptureMode = 'full',
          opts: CaptureOptions = {},
        ): Promise<string> {
          return startCapture(await chrome.tabs.get(tabId), mode, opts);
        },
        /** What a toolbar click does (Playwright can't click the browser's toolbar). */
        async click(tabId: number): Promise<string | null> {
          return capture(await chrome.tabs.get(tabId), 'full');
        },
        /** What choosing a right-click menu entry does. */
        async menu(menuItemId: string, tabId: number) {
          return onMenu({ menuItemId }, await chrome.tabs.get(tabId));
        },
        async badge(tabId: number) {
          const action = actionApi();
          return {
            text: (await action?.getBadgeText({ tabId })) ?? '',
            title: (await action?.getTitle({ tabId })) ?? '',
          };
        },
        failGrabAt(index: number | null) {
          failGrabAt = index;
        },
        /** Simulates a service-worker restart: all in-memory capture state is lost. */
        forgetMemory() {
          known.clear();
          windowOf.clear();
          sharp.clear();
          quietTabs.clear();
          silent.clear();
        },
        async capture(tabId: number, mode: CaptureMode = 'full') {
          const hook = (globalThis as unknown as { __spTest: E2EHook }).__spTest;
          return hook.wait(await hook.start(tabId, mode));
        },
        async wait(id: string) {
          const done =
            finished.get(id) ??
            (await new Promise<CaptureDone>((resolve) => waiters.set(id, resolve)));
          const frames = (await (await db()).getAllFromIndex('frames', 'bySession', id))
            .sort((a, b) => a.index - b.index)
            .map(({ blob: _blob, ...rest }) => rest);
          return { id, done, frames };
        },
        /** Frame PNGs as base64, for stitching and inspection in tests. */
        async frameImages(id: string): Promise<string[]> {
          const frames = (await (await db()).getAllFromIndex('frames', 'bySession', id)).sort(
            (a, b) => a.index - b.index,
          );
          return Promise.all(
            frames.map(async (f) => {
              const bytes = new Uint8Array(await f.blob.arrayBuffer());
              let bin = '';
              for (let i = 0; i < bytes.length; i += 0x8000) {
                bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
              }
              return btoa(bin);
            }),
          );
        },
      },
    });
  }
});

/** A batch target that can't be captured: skipped, with the reason, not failed. */
class Skip extends Error {}

interface PopupCapture {
  type: 'sp:popup-capture';
  mode: CaptureMode;
  delayMs?: number;
}

interface CaptureOptions {
  limits?: CaptureLimits;
  delayMs?: number;
  region?: Region;
  hideOverlays?: boolean;
  silent?: boolean;
}

interface E2EHook {
  start(tabId: number, mode?: CaptureMode, opts?: CaptureOptions): Promise<string>;
  wait(id: string): Promise<unknown>;
}
