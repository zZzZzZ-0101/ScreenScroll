import { Pacer, blockedReason } from '@scrollpress/core';
import { db } from '@/lib/db';
import type { CaptureDone, CaptureMode, GrabFrame, GrabResult, ToBackground } from '@/lib/messages';
import { dataUrlToBlob, pngSize } from '@/lib/png';

export default defineBackground(() => {
  const pacer = new Pacer();
  const tabOf = new Map<string, chrome.tabs.Tab>();
  const waiters = new Map<string, (done: CaptureDone) => void>();
  // e2e only: finished sessions (a test may wait after the capture already ended) and an
  // injected grab failure, to exercise the error path.
  const finished = new Map<string, CaptureDone>();
  let failGrabAt: number | null = null;

  async function startCapture(tab: chrome.tabs.Tab, mode: CaptureMode): Promise<string> {
    const blocked = blockedReason(tab.url, await chrome.extension.isAllowedFileSchemeAccess());
    if (blocked || tab.id === undefined) throw new Error(blocked?.message ?? 'No tab to capture.');
    const id = crypto.randomUUID();
    tabOf.set(id, tab);
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
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/capture.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'sp:start', sessionId: id, mode });
    return id;
  }

  async function grab(msg: GrabFrame): Promise<GrabResult> {
    const tab = tabOf.get(msg.sessionId);
    if (!tab) return { ok: false, error: 'Unknown capture session.' };
    if (__SP_E2E__ && failGrabAt === msg.index) {
      failGrabAt = null;
      return { ok: false, error: 'Injected test failure' };
    }
    try {
      const dataUrl = await pacer.run(() =>
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }),
      );
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
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function finish(msg: CaptureDone): Promise<void> {
    const d = await db();
    const session = await d.get('sessions', msg.sessionId);
    const frameCount = await d.countFromIndex('frames', 'bySession', msg.sessionId);
    if (session) {
      await d.put('sessions', {
        ...session,
        status: msg.status,
        docWidth: msg.docWidth,
        docHeight: msg.docHeight,
        frameCount,
        warnings: msg.warnings,
      });
    }
    tabOf.delete(msg.sessionId);
    if (__SP_E2E__) finished.set(msg.sessionId, msg);
    waiters.get(msg.sessionId)?.(msg);
    waiters.delete(msg.sessionId);
  }

  chrome.runtime.onMessage.addListener((msg: ToBackground | PopupCapture, _sender, reply) => {
    if (msg.type === 'sp:grab') {
      void grab(msg).then(reply);
      return true;
    }
    if (msg.type === 'sp:done') {
      void finish(msg).then(() => reply({ ok: true }));
      return true;
    }
    if (msg.type === 'sp:popup-capture') {
      void activeTab()
        .then((tab) => startCapture(tab, msg.mode))
        .then(
          () => reply({ ok: true }),
          (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      return true;
    }
    return false;
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    const mode =
      command === 'capture-full' ? 'full' : command === 'capture-visible' ? 'visible' : null;
    if (mode && tab) void startCapture(tab, mode).catch(console.warn);
  });

  async function activeTab(): Promise<chrome.tabs.Tab> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab.');
    return tab;
  }

  if (__SP_E2E__) {
    // Test hook: Playwright cannot click the toolbar button, so it calls this directly.
    Object.assign(globalThis, {
      __spTest: {
        async start(tabId: number, mode: CaptureMode = 'full'): Promise<string> {
          return startCapture(await chrome.tabs.get(tabId), mode);
        },
        failGrabAt(index: number | null) {
          failGrabAt = index;
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
}

interface E2EHook {
  start(tabId: number, mode?: CaptureMode): Promise<string>;
  wait(id: string): Promise<unknown>;
}
