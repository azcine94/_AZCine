import type { ProjectImage } from './projects-contract.ts';

export interface ImageImportState {
  request: { files: File[]; imported: ProjectImage[] } | null;
  busy: boolean; error: string;
}
/** Owned by the page-independent project controller so failed imports survive navigation. */
export function createImageImportDraft() {
  let state: ImageImportState = { request: null, busy: false, error: '' };
  const listeners = new Set<() => void>();
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(patch: Partial<ImageImportState>) { state = { ...state, ...patch }; for (const listener of listeners) listener(); },
  };
}
export type ImageImportDraft = ReturnType<typeof createImageImportDraft>;
