/** Attributes lazy-loading libraries commonly park the real URL in (CAPTURE §5). */
export const LAZY_SRC_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy'] as const;
export const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'] as const;

/**
 * True when `src` is empty or an obvious placeholder, so copying `data-src` over it is safe.
 * A real image URL is never replaced: that would change what the page shows.
 */
export function isPlaceholderSrc(src: string | null | undefined): boolean {
  if (!src) return true;
  const s = src.trim();
  if (s === '' || s === '#' || s === 'about:blank') return true;
  // Tiny inline images: 1×1 GIFs, blank SVGs, base64 stubs.
  if (s.startsWith('data:')) return s.length < 400;
  // A file named only with placeholder words ("blank.gif", "lazy-loading.svg"). Names with
  // other words ("lazyriver-trip.jpg") are treated as real images.
  const name = s.split(/[?#]/)[0]!.split('/').pop() ?? '';
  const m = /^(.+)\.(gif|png|svg|jpe?g|webp)$/i.exec(name);
  return !!m && m[1]!.split(/[-_.]+/).every((t) => PLACEHOLDER_WORDS.has(t.toLowerCase()));
}

const PLACEHOLDER_WORDS = new Set([
  'blank',
  'placeholder',
  'spacer',
  'pixel',
  'transparent',
  'lazy',
  'loading',
  'loader',
  'empty',
  '1x1',
]);
