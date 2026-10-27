/** The slice of `CSSStyleDeclaration` the log needs, so it is testable without a DOM. */
export interface StyleLike {
  getPropertyValue(prop: string): string;
  getPropertyPriority(prop: string): string;
  setProperty(prop: string, value: string, priority?: string): void;
  removeProperty(prop: string): string;
}

export interface Styled {
  style: StyleLike;
}

/**
 * CAPTURE §10: every page mutation goes through here and is undone in reverse order.
 * Restore is idempotent and keeps going past a failing undo (e.g. a node removed by the
 * page), so one bad entry never leaves the rest of the page altered.
 */
export class MutationLog {
  private undos: Array<() => void> = [];

  get size(): number {
    return this.undos.length;
  }

  /** Sets an inline style (important by default, to beat page CSS) and logs the old inline value. */
  setStyle(el: Styled, prop: string, value: string, important = true): void {
    const oldValue = el.style.getPropertyValue(prop);
    const oldPriority = el.style.getPropertyPriority(prop);
    this.undos.push(() => {
      if (oldValue === '') el.style.removeProperty(prop);
      else el.style.setProperty(prop, oldValue, oldPriority);
    });
    el.style.setProperty(prop, value, important ? 'important' : '');
  }

  /** Logs an arbitrary undo step (attributes, video play state, scroll offsets, injected nodes). */
  record(undo: () => void): void {
    this.undos.push(undo);
  }

  /** Undoes everything, newest first. Returns the errors it swallowed so callers can warn. */
  restore(): unknown[] {
    const errors: unknown[] = [];
    const undos = this.undos;
    this.undos = [];
    for (let i = undos.length - 1; i >= 0; i--) {
      try {
        undos[i]!();
      } catch (e) {
        errors.push(e);
      }
    }
    return errors;
  }
}
