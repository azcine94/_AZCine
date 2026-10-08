import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Button } from './components/ui/button.tsx';
import { Feedback } from './components/ui/feedback.tsx';
import { AttachmentPreview } from './components/ui/attachment-preview.tsx';
import { invoke, isTauri } from './desktop-api.ts';
import { parseProjectImage } from './projects-contract.ts';
import type { ProjectImage } from './projects-contract.ts';
import type { ImageImportDraft } from './project-image-imports.ts';

export function ProjectCellImages({ images, disabled, label, change, children, importDraft, height, emptyText = false }: {
  images: ProjectImage[]; disabled: boolean; label: string; children: ReactNode;
  change(update: (images: ProjectImage[]) => ProjectImage[]): boolean;
  importDraft: ImageImportDraft; height?: number; emptyText?: boolean;
}) {
  const mounted = useRef(true);
  const latest = useRef({ images, disabled, change }); latest.current = { images, disabled, change };
  const { busy, error, request: pending } = useSyncExternalStore(importDraft.subscribe, importDraft.snapshot);
  const hasPending = !!pending;
  const [dragging, setDragging] = useState(false);
  const setError = (error: string) => importDraft.set({ error });
  const depth = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function importFiles(files?: File[]) {
    if (importDraft.snapshot().busy || latest.current.disabled) return;
    if (files) {
      if (!files.length) return;
      if (importDraft.snapshot().request) { setError('上次导入尚未完成，请先重试或取消该批导入。'); return; }
      importDraft.set({ request: { files, imported: [] } });
    }
    const request = importDraft.snapshot().request; if (!request) return;
    importDraft.set({ busy: true, error: '' });
    try {
      if (!isTauri()) throw new Error('请在桌面版中导入图片。');
      if (latest.current.images.length + request.files.length > 16) throw new Error('每格最多16张图片，原图片和文字保留。');
      for (const file of request.files) if (!file.size || file.size > 50 * 1024 * 1024 || !(/^image\/(png|jpeg|webp|gif)$/.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name))) throw new Error('请选择PNG、JPEG、WebP或GIF图片，每张不超过50MiB。');
      for (let index = request.imported.length; index < request.files.length; index++) {
        if (!mounted.current) return;
        const file = request.files[index], bytes = new Uint8Array(await file.arrayBuffer());
        if (!mounted.current) return;
        request.imported.push(parseProjectImage(await invoke('project_import_image', { input: { name: Array.from(file.name || '剪贴板图片.png').slice(0, 200).join(''), bytes: Array.from(bytes) } })));
      }
      if (!mounted.current) return;
      if (latest.current.disabled || !latest.current.change(before => {
        const additions = request.imported.filter(image => !before.some(saved => saved.id === image.id));
        if (before.length + additions.length > 16) throw new Error('单元格图片数量已变化，请取消该批导入或调整后重试。');
        return [...before, ...additions];
      })) throw new Error('单元格暂时无法更新，导入副本保留，请重试。');
      importDraft.set({ request: null });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '图片导入失败，原内容和待导入图片保留。'); }
    finally { importDraft.set({ busy: false }); }
  }
  return <div className="project-cell-images" aria-label={label} data-has-images={!!images.length} data-image-only={!!images.length && emptyText} style={height ? {height:height-2} : undefined} data-dragging={dragging || undefined} aria-busy={busy} onPasteCapture={event => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (files.length) { event.preventDefault(); event.stopPropagation(); void importFiles(files); }
  }} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); depth.current++; if (!disabled) setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = disabled || busy ? 'none' : 'copy'; } }} onDragLeave={event => { if (event.dataTransfer.types.includes('Files')) { event.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); } }} onDrop={event => {
    if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false); void importFiles(Array.from(event.dataTransfer.files)); }
  }}>
    <div className="project-cell-value">{children}</div>
    {!!images.length && <div className="project-cell-image-tray" style={{gridTemplateColumns:`repeat(${Math.min(images.length,2)},minmax(0,1fr))`}}>{images.map(image => <AttachmentPreview key={image.id} compact value={{ ...image, projectImage: image }} disabled={disabled || busy} onRemove={() => { change(before => before.filter(item => item.id !== image.id)); }}/>)}</div>}
    {busy && <span className="project-cell-image-status" role="status">正在导入图片…</span>}
    {error && <Feedback tone="error" role="alert">{error}</Feedback>}
    {hasPending && !busy && <div className="project-cell-image-retry"><Button variant="app-text" size="xs" type="button" disabled={disabled} onClick={() => void importFiles()}>重试导入</Button><Button variant="app-text" size="xs" type="button" onClick={() => importDraft.set({ request: null, error: '' })}>取消该批</Button></div>}
  </div>;
}
