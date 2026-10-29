import {
  CAPTURE_PACING,
  Pacer,
  blockedReason,
  type CaptureLimits,
  type Region,
} from '@screenscroll/core';
import { db, deleteCapture, deleteOlderThan } from '@/shared/db';
import {
  TAB_HIDDEN,
  type CaptureControl,
  type CaptureDone,
  type CaptureMode,
  type GrabFrame,
  type GrabResult,
  type PageNotice,
  type ToBackground,
} from '@/shared/messages';
import { dataUrlToBlob, pngSize } from '@/shared/png';
import { loadSettings, RESOLUTION_SCALE, SPEED_TIMING } from '@/shared/settings';

export default defineBackground(() => {
  let pacer = new Pacer();
  // Captures rendered at a higher pixel density through the debugger (Settings → Sharpness).
  const sharp = new Map<string, { tabId: number; failed: boolean }>();
  // Window of each running capture. Only a cache: the service worker can be stopped at any
  // time, so the session record in IndexedDB is the source of truth.
  const windowOf = new Map<string, number>();
  const waiters = new Map<string, (done: CaptureDone) => void>();
  // e2e only: finished sessions (a test may wait after the capture already ended) and an
  // injected grab failure, to exercise the error path.
  const finished = new Map<string, CaptureDone>();
  let failGrabAt: number | null = null;

  async function startCapture(
    tab: chrome.tabs.Tab,
    mode: CaptureMode,
    opts: CaptureOptions = {},
  ): Promise<string> {
    const blocked = blockedReason(tab.url, await chrome.extension.isAllowedFileSchemeAccess());
    if (blocked || tab.id === undefined) throw new Error(blocked?.message ?? 'No tab to capture.');
    const id = crypto.randomUUID();
    windowOf.set(id, tab.windowId);
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
    });
    const settings = await loadSettings();
    const timing = SPEED_TIMING[settings.capture.speed];
    pacer = new Pacer({ ...CAPTURE_PACING, minIntervalMs: timing.intervalMs });
    const warnings: string[] = [];
    const scale = RESOLUTION_SCALE[settings.capture.resolution];
    if (scale > 1) {
      const why = await startSharp(id, tab.id, scale);
      if (why) warnings.push(why);
    }
    if (warnings.length) {
      const d = await db();
      const rec = await d.get('sessions', id);
      if (rec) await d.put('sessions', { ...rec, warnings });
    }
    await showCapturing(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/capture.js'] });
    await chrome.tabs.sendMessage(tab.id, {
      type: 'sp:start',
      sessionId: id,
      mode,
      startAt: settings.capture.start,
      timing,
      ...opts,
    });
    return id;
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
    if (!(await chrome.permissions.contains({ permissions: ['debugger'] })))
      return 'Sharp capture needs permission; open Settings → Sharpness to allow it. Captured at screen resolution.';
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
        width: 0,
        height: 0,
        deviceScaleFactor: scale,
        mobile: false,
      });
      sharp.set(sessionId, { tabId, failed: false });
      return null;
    } catch (e) {
      await chrome.debugger.detach({ tabId }).catch(() => undefined);
      return `Sharp capture was not possible (${e instanceof Error ? e.message : String(e)}); captured at screen resolution.`;
    }
  }

  async function stopSharp(sessionId: string): Promise<void> {
    const s = sharp.get(sessionId);
    if (!s) return;
    sharp.delete(sessionId);
    await chrome.debugger
      .sendCommand({ tabId: s.tabId }, 'Emulation.clearDeviceMetricsOverride')
      .catch(() => undefined);
    await chrome.debugger.detach({ tabId: s.tabId }).catch(() => undefined);
  }

  /**
   * While a capture runs, the icon says so, and its tooltip says how to stop: the user may
   * have started it by accident from a menu or a key.
   */
  async function showCapturing(tabId: number): Promise<void> {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0e7c7b' });
    await chrome.action.setBadgeText({ tabId, text: 'REC' });
    await chrome.action.setTitle({
      tabId,
      title:
        'ScreenScroll is capturing this tab. Press Esc on the page to cancel, or click here to stop.',
    });
  }

  async function clearCapturing(tabId: number | undefined): Promise<void> {
    if (tabId === undefined) return;
    const text = await chrome.action.getBadgeText({ tabId }).catch(() => '');
    if (text !== 'REC' && text !== 'WAIT') return;
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    await chrome.action.setTitle({ tabId, title: ICON_TITLE }).catch(() => undefined);
  }

  /** The capturing tab must be the one in front: captureVisibleTab pictures that one. */
  async function inFront(tabId: number | undefined): Promise<boolean> {
    if (tabId === undefined) return true;
    const t = await chrome.tabs.get(tabId).catch(() => null);
    return !!t?.active;
  }

  async function grab(msg: GrabFrame, tabId?: number): Promise<GrabResult> {
    let windowId = windowOf.get(msg.sessionId);
    if (windowId === undefined) {
      windowId = (await (await db()).get('sessions', msg.sessionId))?.windowId;
      if (windowId === undefined) return { ok: false, error: 'Unknown capture session.' };
      windowOf.set(msg.sessionId, windowId);
    }
    if (__SP_E2E__ && failGrabAt === msg.index) {
      failGrabAt = null;
      return { ok: false, error: 'Injected test failure' };
    }
    if (!(await inFront(tabId))) {
      // The page can't show this while its tab is hidden; the icon can.
      if (tabId !== undefined) {
        await chrome.action.setBadgeText({ tabId, text: 'WAIT' }).catch(() => undefined);
        await chrome.action
          .setTitle({
            tabId,
            title: 'ScreenScroll paused: the capture goes on when you return to its tab.',
          })
          .catch(() => undefined);
      }
      return { ok: false, error: TAB_HIDDEN };
    }
    if (tabId !== undefined && (await chrome.action.getBadgeText({ tabId })) === 'WAIT')
      await showCapturing(tabId);
    try {
      const hi = sharp.get(msg.sessionId);
      const dataUrl =
        hi && !hi.failed
          ? await chrome.debugger
              .sendCommand({ tabId: hi.tabId }, 'Page.captureScreenshot', { format: 'png' })
              .then((r) => `data:image/png;base64,${(r as { data: string }).data}`)
              .catch(async () => {
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
    const hi = sharp.get(msg.sessionId);
    if (hi?.failed)
      msg.warnings.push(
        'Sharp capture stopped part-way (the debugging bar was closed); the rest is at screen resolution.',
      );
    await stopSharp(msg.sessionId);
    const d = await db();
    const session = await d.get('sessions', msg.sessionId);
    await clearCapturing(session?.tabId);
    if (msg.status === 'cancelled') {
      // Cancel (Esc) means "I didn't want this": nothing is kept and nothing opens. "Stop
      // here" is the way to keep a partial capture.
      await deleteCapture(msg.sessionId);
      windowOf.delete(msg.sessionId);
      if (__SP_E2E__) finished.set(msg.sessionId, msg);
      waiters.get(msg.sessionId)?.(msg);
      waiters.delete(msg.sessionId);
      return;
    }
    const frameCount = await d.countFromIndex('frames', 'bySession', msg.sessionId);
    if (session) {
      await d.put('sessions', {
        ...session,
        status: msg.status,
        docWidth: msg.docWidth,
        docHeight: msg.docHeight,
        frameCount,
        warnings: [...session.warnings, ...msg.warnings],
      });
    }
    windowOf.delete(msg.sessionId);
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
    if (frameCount > 0) await openStudio(msg.sessionId, msg.output, session?.tabId);
    if (__SP_E2E__) finished.set(msg.sessionId, msg);
    waiters.get(msg.sessionId)?.(msg);
    waiters.delete(msg.sessionId);
  }

  async function openStudio(
    sessionId: string,
    output?: CaptureDone['output'],
    openerTabId?: number,
  ): Promise<void> {
    const { afterCapture } = await loadSettings();
    const mode = output ?? (afterCapture === 'pdf' ? 'pdf' : 'studio');
    const url = chrome.runtime.getURL(
      `/studio.html?session=${encodeURIComponent(sessionId)}${mode === 'studio' ? '' : `&auto=${mode}`}`,
    );
    // "Save PDF directly" works in a background tab that closes itself when done. Copying
    // needs a focused page, so that tab comes to the front and closes back to the page.
    const opener =
      openerTabId !== undefined && (await inFront(openerTabId)) ? openerTabId : undefined;
    await chrome.tabs.create({ url, active: mode !== 'pdf', openerTabId: opener });
  }

  /** The capture running in the active tab, if any (for the toolbar panel). */
  async function running(): Promise<{ sessionId: string; tabId: number } | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    const s = (await (await db()).getAll('sessions')).find(
      (x) => x.status === 'capturing' && x.tabId === tab.id,
    );
    return s ? { sessionId: s.id, tabId: tab.id } : null;
  }

  chrome.runtime.onMessage.addListener(
    (
      msg: ToBackground | PopupCapture | CaptureControl | PageNotice | { type: 'sp:running' },
      _sender,
      reply,
    ) => {
      if (msg.type === 'sp:grab') {
        void grab(msg, _sender.tab?.id).then(reply);
        return true;
      }
      if (msg.type === 'sp:notice') {
        if (msg.tabId !== undefined)
          void chrome.tabs
            .sendMessage(msg.tabId, { type: 'sp:notice', text: msg.text })
            .catch(() => undefined);
        return false;
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
    try {
      if (tabId !== undefined) {
        await chrome.action.setBadgeText({ tabId, text: '' });
        await chrome.action.setTitle({ tabId, title: ICON_TITLE });
      }
      return await startCapture(tab, mode, opts);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (tabId !== undefined) {
        await chrome.action.setBadgeBackgroundColor({ tabId, color: '#b3261e' });
        await chrome.action.setBadgeText({ tabId, text: '!' });
        await chrome.action.setTitle({ tabId, title: `ScreenScroll: ${message}` });
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
          return {
            text: await chrome.action.getBadgeText({ tabId }),
            title: await chrome.action.getTitle({ tabId }),
          };
        },
        failGrabAt(index: number | null) {
          failGrabAt = index;
        },
        /** Simulates a service-worker restart: all in-memory capture state is lost. */
        forgetMemory() {
          windowOf.clear();
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

interface PopupCapture {
  type: 'sp:popup-capture';
  mode: CaptureMode;
  delayMs?: number;
}

interface CaptureOptions {
  limits?: CaptureLimits;
  delayMs?: number;
  region?: Region;
}

interface E2EHook {
  start(tabId: number, mode?: CaptureMode, opts?: CaptureOptions): Promise<string>;
  wait(id: string): Promise<unknown>;
}
