import { describe, expect, it } from 'vitest';
import { MutationLog, type StyleLike } from '../src/mutation-log.js';

/** In-memory inline style with priorities, mirroring CSSStyleDeclaration semantics we rely on. */
function fakeStyle(
  init: Record<string, [string, string?]> = {},
): StyleLike & { dump(): Record<string, string> } {
  const map = new Map<string, { v: string; p: string }>(
    Object.entries(init).map(([k, [v, p]]) => [k, { v, p: p ?? '' }]),
  );
  return {
    getPropertyValue: (k) => map.get(k)?.v ?? '',
    getPropertyPriority: (k) => map.get(k)?.p ?? '',
    setProperty: (k, v, p = '') => void map.set(k, { v, p }),
    removeProperty: (k) => {
      const old = map.get(k)?.v ?? '';
      map.delete(k);
      return old;
    },
    dump: () => Object.fromEntries([...map].map(([k, { v, p }]) => [k, p ? `${v} !${p}` : v])),
  };
}

describe('MutationLog', () => {
  it('restores original inline styles, including absent ones and priorities', () => {
    const el = { style: fakeStyle({ top: ['4px', 'important'] }) };
    const log = new MutationLog();
    log.setStyle(el, 'position', 'relative');
    log.setStyle(el, 'top', 'auto');
    expect(el.style.dump()).toEqual({ position: 'relative !important', top: 'auto !important' });
    log.restore();
    expect(el.style.dump()).toEqual({ top: '4px !important' });
  });

  it('restores the first recorded value when a property is changed twice', () => {
    const el = { style: fakeStyle({ visibility: ['visible'] }) };
    const log = new MutationLog();
    log.setStyle(el, 'visibility', 'hidden');
    log.setStyle(el, 'visibility', 'collapse');
    log.restore();
    expect(el.style.dump()).toEqual({ visibility: 'visible' });
  });

  it('is idempotent', () => {
    const el = { style: fakeStyle() };
    const log = new MutationLog();
    log.setStyle(el, 'animation-duration', '1ms');
    log.restore();
    el.style.setProperty('color', 'red');
    expect(log.restore()).toEqual([]);
    expect(el.style.dump()).toEqual({ color: 'red' });
  });

  it('keeps undoing past a failing step and reports the error', () => {
    const order: string[] = [];
    const log = new MutationLog();
    log.record(() => order.push('first'));
    log.record(() => {
      throw new Error('node gone');
    });
    log.record(() => order.push('third'));
    const errors = log.restore();
    expect(order).toEqual(['third', 'first']);
    expect(errors).toHaveLength(1);
    expect(log.size).toBe(0);
  });

  it('removes a style attribute the element did not have before', () => {
    const attrs = new Set<string>();
    const el = {
      style: fakeStyle(),
      hasAttribute: (n: string) => attrs.has(n),
      getAttribute: (n: string) => (attrs.has(n) ? '' : null),
      removeAttribute: (n: string) => void attrs.delete(n),
    };
    const log = new MutationLog();
    log.setStyle(el, 'visibility', 'hidden');
    attrs.add('style'); // what the browser does when an inline style is set
    log.setStyle(el, 'position', 'relative');
    log.restore();
    expect(attrs.has('style')).toBe(false);
  });

  it('keeps a style attribute the element already had', () => {
    const attrs = new Set<string>(['style']);
    const el = {
      style: fakeStyle({ color: ['red'] }),
      hasAttribute: (n: string) => attrs.has(n),
      getAttribute: (n: string) => (attrs.has(n) ? 'color: red' : null),
      removeAttribute: (n: string) => void attrs.delete(n),
    };
    const log = new MutationLog();
    log.setStyle(el, 'visibility', 'hidden');
    log.restore();
    expect(attrs.has('style')).toBe(true);
    expect(el.style.dump()).toEqual({ color: 'red' });
  });
});
