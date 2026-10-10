/** A fold control must not consume scrolling, dragging, a context menu or a
 * second finger. Only a completed primary pointer gesture activates it. */
export function onCompletedTap(element: HTMLElement, activate: () => void): () => void {
  const document = element.ownerDocument;
  let pending: { id: number; x: number; y: number } | null = null;
  const cancel = () => {
    pending = null;
    document.removeEventListener("pointerdown", otherPointer, true);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("pointercancel", cancel, true);
  };
  const moved = (event: PointerEvent) => !!pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8;
  const otherPointer = (event: PointerEvent) => { if (pending && event.pointerId !== pending.id) cancel(); };
  const move = (event: PointerEvent) => { if (event.pointerId === pending?.id && moved(event)) cancel(); };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pending?.id) return;
    const completed = !moved(event) && element.contains(event.target as Node) && element.isConnected;
    cancel();
    if (completed) activate();
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    cancel(); pending = { id: event.pointerId, x: event.clientX, y: event.clientY };
    document.addEventListener("pointerdown", otherPointer, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
  };
  const mouseDown = (event: MouseEvent) => { if (event.button === 0) event.preventDefault(); };
  element.addEventListener("pointerdown", down);
  element.addEventListener("mousedown", mouseDown);
  element.addEventListener("contextmenu", cancel);
  return () => {
    cancel(); element.removeEventListener("pointerdown", down);
    element.removeEventListener("mousedown", mouseDown); element.removeEventListener("contextmenu", cancel);
  };
}
