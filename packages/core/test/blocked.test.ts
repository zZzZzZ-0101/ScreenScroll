import { describe, expect, it } from 'vitest';
import { blockedReason } from '../src/blocked.js';

describe('blockedReason', () => {
  it.each([
    ['chrome://settings', 'browser-page'],
    ['edge://flags', 'browser-page'],
    ['about:blank', 'browser-page'],
    ['view-source:https://example.org/', 'browser-page'],
    ['https://chromewebstore.google.com/detail/x', 'web-store'],
    ['https://chrome.google.com/webstore/detail/x', 'web-store'],
    ['chrome-extension://abcdefghijklmnop/page.html', 'extension-page'],
    ['chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', 'pdf-viewer'],
    ['file:///C:/Users/me/doc.pdf', 'pdf-viewer'],
    ['file:///C:/Users/me/page.html', 'file-access'],
    [undefined, 'no-url'],
    ['not a url', 'no-url'],
  ])('%s → %s', (url, reason) => {
    expect(blockedReason(url)?.reason).toBe(reason);
  });

  it.each([
    'https://en.wikipedia.org/wiki/PDF',
    'http://localhost:5177/article.html',
    'https://example.org/a.pdf',
  ])('allows %s', (url) => {
    expect(blockedReason(url)).toBeNull();
  });

  it('allows local files once file access is granted', () => {
    expect(blockedReason('file:///home/me/page.html', true)).toBeNull();
  });
});
