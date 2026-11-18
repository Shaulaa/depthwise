export interface PointerInfo {
  /** Normalised device coordinates, -1..1 with +y up. */
  ndcX: number;
  ndcY: number;
  clientX: number;
  clientY: number;
}

type Handler<T> = (payload: T) => void;

const TAP_DISTANCE = 7;
const TAP_DURATION = 450;

/** Pointer, wheel and keyboard input for the canvas: drag to orbit, pinch/wheel to zoom, tap to pick. */
export class Input {
  readonly keys = new Set<string>();
  readonly pointer: PointerInfo = { ndcX: 0, ndcY: 0, clientX: 0, clientY: 0 };
  /** True while the pointer has moved since the last time it was consumed. */
  pointerMoved = false;

  private readonly active = new Map<number, { x: number; y: number }>();
  private downAt = 0;
  private travelled = 0;
  private pinchDistance = 0;

  private readonly dragHandlers: Handler<{ dx: number; dy: number }>[] = [];
  private readonly zoomHandlers: Handler<number>[] = [];
  private readonly tapHandlers: Handler<PointerInfo>[] = [];
  private readonly keyHandlers: Handler<string>[] = [];

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onCancel);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }

  onDrag(fn: Handler<{ dx: number; dy: number }>): void {
    this.dragHandlers.push(fn);
  }

  onZoom(fn: Handler<number>): void {
    this.zoomHandlers.push(fn);
  }

  onTap(fn: Handler<PointerInfo>): void {
    this.tapHandlers.push(fn);
  }

  onKey(fn: Handler<string>): void {
    this.keyHandlers.push(fn);
  }

  get dragging(): boolean {
    return this.active.size > 0;
  }

  private track(e: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    this.pointer.clientX = e.clientX;
    this.pointer.clientY = e.clientY;
    this.pointer.ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.pointerMoved = true;
  }

  private readonly onDown = (e: PointerEvent): void => {
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety for drags that leave the canvas; some pointers cannot be captured.
    }
    this.active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.track(e);
    if (this.active.size === 1) {
      this.downAt = performance.now();
      this.travelled = 0;
    } else if (this.active.size === 2) {
      this.pinchDistance = this.currentPinch();
      this.travelled = Infinity; // a second finger never counts as a tap
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    this.track(e);
    const prev = this.active.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    if (this.active.size === 1) {
      this.travelled += Math.hypot(dx, dy);
      if (this.travelled > TAP_DISTANCE) for (const fn of this.dragHandlers) fn({ dx, dy });
    } else if (this.active.size === 2) {
      const dist = this.currentPinch();
      if (this.pinchDistance > 0) for (const fn of this.zoomHandlers) fn((this.pinchDistance - dist) * 3);
      this.pinchDistance = dist;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.active.has(e.pointerId)) return;
    this.active.delete(e.pointerId);
    this.track(e);
    const quick = performance.now() - this.downAt < TAP_DURATION;
    if (this.active.size === 0 && quick && this.travelled <= TAP_DISTANCE) {
      for (const fn of this.tapHandlers) fn(this.pointer);
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.active.delete(e.pointerId);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 32 : 1;
    for (const fn of this.zoomHandlers) fn(e.deltaY * scale);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Leave the keyboard alone while a dialog is open so it stays fully operable.
    if (document.querySelector('dialog[open]')) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Space and Enter must keep activating a focused button.
    const onControl = tag === 'BUTTON' || tag === 'A';
    if (onControl && (key === ' ' || key === 'Enter')) return;
    if (key.startsWith('Arrow') || key === ' ') e.preventDefault();
    if (!e.repeat) for (const fn of this.keyHandlers) fn(key);
    this.keys.add(key);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  };

  private currentPinch(): number {
    const [a, b] = [...this.active.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
