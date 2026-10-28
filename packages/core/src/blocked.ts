export type BlockReason =
  'browser-page' | 'web-store' | 'extension-page' | 'pdf-viewer' | 'file-access' | 'no-url';

export interface BlockInfo {
  reason: BlockReason;
  message: string;
}

const WEB_STORE_HOSTS = ['chromewebstore.google.com', 'microsoftedge.microsoft.com'];

/**
 * CAPTURE §13: pages the browser won't let extensions script or capture. Returns null when
 * capture can be attempted. `fileAccess` is `chrome.extension.isAllowedFileSchemeAccess()`.
 */
export function blockedReason(url: string | undefined, fileAccess = false): BlockInfo | null {
  // Without the `tabs` permission the browser hides the URL of restricted pages
  // (chrome://, edge://, the store), so a missing URL almost always means one of those.
  if (!url) {
    return {
      reason: 'no-url',
      message:
        'This page can’t be captured. The browser blocks extensions on its own pages (chrome://, edge://) and on the extension store.',
    };
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { reason: 'no-url', message: 'This tab has no page to capture.' };
  }
  const scheme = u.protocol.slice(0, -1);

  if (scheme === 'javascript' || scheme === 'data') {
    return {
      reason: 'browser-page',
      message: 'This kind of address can’t be captured. Open a regular web page.',
    };
  }
  if (['chrome', 'edge', 'about', 'view-source', 'devtools', 'chrome-search'].includes(scheme)) {
    return { reason: 'browser-page', message: 'Browser pages can’t be captured.' };
  }
  if (scheme === 'chrome-extension' || scheme === 'extension' || scheme === 'moz-extension') {
    // The built-in PDF viewer runs as an extension page.
    if (u.host === 'mhjfbmdgcfjbbpaeojofohoefgiehjai') return pdfViewer();
    return { reason: 'extension-page', message: 'Other extensions’ pages can’t be captured.' };
  }
  if (
    WEB_STORE_HOSTS.includes(u.host) ||
    (u.host === 'chrome.google.com' && u.pathname.startsWith('/webstore'))
  ) {
    return { reason: 'web-store', message: 'The browser blocks capture on extension store pages.' };
  }
  if (scheme === 'file') {
    if (/\.pdf$/i.test(u.pathname)) return pdfViewer();
    if (!fileAccess) {
      return {
        reason: 'file-access',
        message:
          'To capture local files, turn on “Allow access to file URLs” for ScrollPress in chrome://extensions.',
      };
    }
  }
  return null;
}

function pdfViewer(): BlockInfo {
  return {
    reason: 'pdf-viewer',
    message:
      'The browser’s PDF viewer can’t be captured. Open the PDF file in ScrollPress Studio instead.',
  };
}
