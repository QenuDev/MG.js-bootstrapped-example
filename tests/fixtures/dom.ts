/**
 * A minimal DOM stub, because the badge is the only DOM surface this package has.
 *
 * `tests/entry/userscript.test.ts` has to observe two things the badge does: whether its host is attached,
 * and whether a host created *after* a `stop()` is left behind. Both are invisible without a document.
 * Node has no DOM, and pulling one in for four assertions would cost far more than the ~90 lines below, which
 * implement the members `src/badge.ts` touches: `createElement`, `attachShadow`, `appendChild`/
 * `append`/`remove`, `style`, `dataset`, `textContent`, `id`, `addEventListener`, and
 * `body ?? documentElement`.
 *
 * This is not a DOM implementation, and the omissions are intentional: no attributes, no events beyond the
 * ones the badge listens for, no CSS, no traversal beyond `findById`. If the badge grows a DOM feature, this
 * stub must grow with it. That is why it lives in `tests/fixtures/` rather than inline in one test file.
 */

/** One element. `parent` is what makes `remove()` able to detach it. */
export class FakeElement {
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  id = '';
  textContent = '';
  parent: FakeElement | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(readonly tagName: string) {}

  /**
   * The badge attaches a shadow root and appends into it. Returning an element keeps `append` in one place;
   * the stub does not model encapsulation, only attachment.
   */
  attachShadow(_init: { mode: 'open' | 'closed' }): FakeElement {
    return this;
  }

  appendChild(node: FakeElement): FakeElement {
    this.children.push(node);
    node.parent = this;
    return node;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  addEventListener(type: string, listener: () => void): void {
    const found = this.listeners.get(type) ?? [];
    found.push(listener);
    this.listeners.set(type, found);
  }

  /** Fire a listener this stub recorded. Only ever called by the tests. */
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  /** Detach from the parent. `BadgeHandle.destroy()` relies on this. */
  remove(): void {
    if (this.parent === null) return;
    const at = this.parent.children.indexOf(this);
    if (at >= 0) this.parent.children.splice(at, 1);
    this.parent = null;
  }

  /** Depth-first search by id, so a test can ask whether the badge host is still attached anywhere. */
  findById(id: string): FakeElement | null {
    for (const child of this.children) {
      if (child.id === id) return child;
      const nested = child.findById(id);
      if (nested !== null) return nested;
    }
    return null;
  }
}

/** A document at `document-start`: `body` is null until `fireBodyReady()`. */
export class FakeDocument {
  readonly documentElement = new FakeElement('html');
  body: FakeElement | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  addEventListener(type: string, listener: () => void): void {
    const found = this.listeners.get(type) ?? [];
    found.push(listener);
    this.listeners.set(type, found);
  }

  /**
   * The upgrade `whenBody` waits for: create the body, then fire `DOMContentLoaded` so the callback runs in
   * the order a browser would.
   */
  fireBodyReady(): void {
    this.body = new FakeElement('body');
    for (const listener of this.listeners.get('DOMContentLoaded') ?? []) listener();
  }

  /** Whether any element in the document still carries `id`. */
  hasElement(id: string): boolean {
    return this.documentElement.findById(id) !== null || (this.body?.findById(id) ?? null) !== null;
  }
}
