/**
 * Runtime browser capability probes so the same extension codebase works cleanly on
 * Chrome, Edge, and Firefox (where Chrome-only APIs such as `chrome.debugger` or
 * `chrome://extensions/shortcuts` do not exist).
 */

/** True when `chrome.debugger` (CDP) is available in this browser. */
export function hasDebugger(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.debugger?.attach === 'function' &&
    typeof chrome.debugger?.sendCommand === 'function'
  );
}

/** True when running inside Firefox (`moz-extension://` origin). */
export function isFirefox(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      typeof chrome.runtime?.getURL === 'function' &&
      chrome.runtime.getURL('').startsWith('moz-extension://')
    );
  } catch {
    return false;
  }
}

/**
 * Verifies the `debugger` permission when available (Chrome/Edge). Returns `false`
 * cleanly on Firefox where `chrome.debugger` does not exist.
 */
export async function ensureDebuggerPermission(): Promise<boolean> {
  if (!hasDebugger()) return false;
  try {
    return await chrome.permissions.request({ permissions: ['debugger'] });
  } catch {
    return chrome.permissions.contains({ permissions: ['debugger'] }).catch(() => false);
  }
}

/** Safe wrapper around `chrome.extension.isAllowedFileSchemeAccess`, which may be absent on Firefox. */
export async function isFileAccessAllowed(): Promise<boolean> {
  try {
    if (
      typeof chrome !== 'undefined' &&
      typeof chrome.extension?.isAllowedFileSchemeAccess === 'function'
    ) {
      return await chrome.extension.isAllowedFileSchemeAccess();
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Returns `chrome.action` (MV3) or `chrome.browserAction` (MV2 fallback), when present. */
export function actionApi(): typeof chrome.action | undefined {
  if (typeof chrome === 'undefined') return undefined;
  return (
    chrome.action ??
    (chrome as unknown as { browserAction?: typeof chrome.action }).browserAction
  );
}

/** URL to manage extension keyboard shortcuts on Chromium/Edge, or `null` on Firefox. */
export function shortcutsPageUrl(): string | null {
  return isFirefox() ? null : 'chrome://extensions/shortcuts';
}
