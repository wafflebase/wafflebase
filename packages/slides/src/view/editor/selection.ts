type Listener = () => void;

/**
 * Transient editor selection state. Holds the ordered list of
 * currently-selected element ids and notifies subscribers on change.
 *
 * Selection is editor-local, not stored in the SlidesDocument:
 * other users see selections via Phase 4 presence, not via Yorkie.
 */
export class Selection {
  private ids: string[] = [];
  private listeners = new Set<Listener>();

  get(): readonly string[] {
    return this.ids;
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  set(next: readonly string[]): void {
    if (sameOrder(this.ids, next)) return;
    this.ids = [...next];
    this.notify();
  }

  toggle(id: string): void {
    const i = this.ids.indexOf(id);
    if (i === -1) {
      this.ids = [...this.ids, id];
    } else {
      this.ids = [...this.ids.slice(0, i), ...this.ids.slice(i + 1)];
    }
    this.notify();
  }

  clear(): void {
    if (this.ids.length === 0) return;
    this.ids = [];
    this.notify();
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
