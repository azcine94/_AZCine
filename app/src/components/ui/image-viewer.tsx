import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Maximize, Minus, Plus, X } from 'lucide-react';
import { Button } from './button.tsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog.tsx';

/** Shared raster viewer. Zoom is relative to the original image dimensions. */
export function ImageViewer({ open, onOpenChange, src, name }: {
  open: boolean; onOpenChange(open: boolean): void; src: string; name: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0, fitted: true });
  const current = useRef(view); current.current = view;
  const drag = useRef<{ id: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const opener = useRef<HTMLElement | null>(null), wasOpen = useRef(false);
  if (open && !wasOpen.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  wasOpen.current = open;
  // Opening a small image must never upscale it to fill the preview window.
  const ready = natural.width > 0 && size.width > 0 && size.height > 0;
  const fit = ready ? Math.max(.01, Math.min(1, (size.width - 32) / natural.width, (size.height - 32) / natural.height)) : 1;
  const zoom = view.fitted ? Math.max(.01, fit) : view.zoom;
  useLayoutEffect(() => {
    if (!open) return;
    setView({ zoom: 1, x: 0, y: 0, fitted: true }); setFailed(false);
  }, [open, src]);
  useLayoutEffect(() => { setNatural({ width: 0, height: 0 }); }, [src]);
  // The dialog portal may mount after the parent effect: observe through its ref.
  const observer = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => () => observer.current?.disconnect(), []);
  const measure = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect(); viewport.current = node;
    if (!node) return;
    const read = () => setSize(before => before.width === node.clientWidth && before.height === node.clientHeight ? before : { width: node.clientWidth, height: node.clientHeight });
    read(); observer.current = new ResizeObserver(read); observer.current.observe(node);
  }, []);
  function changeZoom(next: number, anchorX = 0, anchorY = 0) {
    const before = current.current, old = before.fitted ? Math.max(.01, fit) : before.zoom;
    const limit = Math.max(8, fit), minimum = Math.min(.05, fit);
    const value = Math.max(minimum, Math.min(limit, next)), ratio = value / old;
    const updated = { zoom: value, x: anchorX - (anchorX - before.x) * ratio, y: anchorY - (anchorY - before.y) * ratio, fitted: false };
    current.current = updated; setView(updated);
  }
  function reset() { drag.current = null; setView({ zoom: 1, x: 0, y: 0, fitted: true }); }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent layout="form" showCloseButton={false} className="ui-image-viewer" style={{ animation: 'none' }} onOpenAutoFocus={event => { event.preventDefault(); viewport.current?.focus(); }} onCloseAutoFocus={event => { if(opener.current?.isConnected){event.preventDefault();opener.current.focus({preventScroll:true});} }}>
      <header className="ui-image-viewer-header"><DialogTitle title={name}>{name}</DialogTitle>
        <div className="ui-image-viewer-actions"><Button variant="ghost" size="icon-sm" aria-label="缩小图片" disabled={!natural.width || zoom <= Math.min(.05, fit)} onClick={() => changeZoom(zoom / 1.25)}><Minus/></Button>
          <Button variant="ghost" size="sm" className="ui-image-viewer-percent" title="以原始尺寸查看" disabled={!natural.width} onClick={() => { setView({ zoom: 1, x: 0, y: 0, fitted: false }); }}>{Math.round(zoom * 100)}%</Button>
          <Button variant="ghost" size="icon-sm" aria-label="放大图片" disabled={!natural.width || zoom >= Math.max(8, fit)} onClick={() => changeZoom(zoom * 1.25)}><Plus/></Button>
          <Button variant="ghost" size="sm" onClick={reset}><Maximize/>适应窗口</Button>
          <DialogClose asChild><Button variant="ghost" size="icon-sm" aria-label="关闭图片"><X/></Button></DialogClose>
        </div>
      </header>
      <DialogDescription className="sr-only">滚轮或加减按钮缩放，拖动图片查看细节；按 0 适应窗口，按 1 查看原始尺寸，Escape 关闭。</DialogDescription>
      <div ref={measure} className="ui-image-viewer-viewport" tabIndex={0} aria-label="图片查看区域" onWheel={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (natural.width) changeZoom((current.current.fitted ? Math.max(.01,fit) : current.current.zoom) * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .003), event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
      }} onDoubleClick={() => view.fitted ? setView({ zoom: 1, x: 0, y: 0, fitted: false }) : reset()} onKeyDown={event => {
        if (['+', '=', '-', '0', '1', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
        if (event.key === '+' || event.key === '=') changeZoom(zoom * 1.25);
        else if (event.key === '-') changeZoom(zoom / 1.25);
        else if (event.key === '0') reset();
        else if (event.key === '1') setView({ zoom: 1, x: 0, y: 0, fitted: false });
        else if (event.key.startsWith('Arrow')) setView(before => ({ ...before, fitted: false, zoom, x: before.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: before.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) }));
      }} onPointerDown={event => {
        if (event.button !== 0 || !natural.width) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, originX: view.x, originY: view.y };
      }} onPointerMove={event => {
        const held = drag.current; if (!held || held.id !== event.pointerId) return;
        setView({ zoom, x: held.originX + event.clientX - held.x, y: held.originY + event.clientY - held.y, fitted: false });
      }} onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {failed ? <p role="alert">图片暂时无法读取，请关闭后重试。</p> : <img src={src} alt={name} draggable={false} decoding="async" onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} style={{ width: natural.width || undefined, height: natural.height || undefined, visibility: ready ? 'visible' : 'hidden', transform: `translate(${view.x}px, ${view.y}px) scale(${zoom})` }}/>}
      </div>
      <footer className="ui-image-viewer-footer"><span>滚轮缩放 · 拖动查看 · 双击切换尺寸</span><span>{natural.width ? `${natural.width} × ${natural.height}` : failed ? '读取失败' : '正在读取图片…'}</span></footer>
    </DialogContent>
  </Dialog>;
}
