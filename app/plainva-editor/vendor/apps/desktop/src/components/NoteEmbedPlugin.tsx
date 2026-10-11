import { createRoot } from 'react-dom/client';
import { buildNoteEmbedCoreExtension } from '@plainva/ui';
import { I18nextProvider } from 'react-i18next';
import { VaultContext } from '../contexts/VaultContext';
import { EmbeddedNote } from './MarkdownReader';

/**
 * The desktop `![[...]]` live embed, on the shared core (C12/S20).
 *
 * The CodeMirror mechanics — line scanning, the caret-aware syntax reveal, the
 * widget lifecycle, skipping images so their own plugin keeps them — used to
 * exist twice, once here and once in `buildNoteEmbedCoreExtension`, which was
 * written from this file and then had no caller at all. What is genuinely
 * desktop-specific is only the preview itself: a React root that can reach the
 * vault context, i18n, and the `.base` viewer. So that is all that is left
 * here; everything else comes from the core.
 */
export function noteEmbedPlugin(contextProps: any, hideSyntax: boolean) {
  return buildNoteEmbedCoreExtension(
    {
      render(container, target) {
        const root = createRoot(container);
        root.render(
          <I18nextProvider i18n={contextProps.i18n}>
            <VaultContext.Provider value={contextProps.vaultContext}>
              <EmbeddedNote
                depth={0}
                target={target}
                onOpenPath={contextProps.onOpenPath}
                hostPath={contextProps.hostPath}
              />
            </VaultContext.Provider>
          </I18nextProvider>
        );
        return () => queueMicrotask(() => root.unmount());
      },
    },
    hideSyntax
  );
}
