// Generates the vendored editor assets during the normal Vite startup/build.
// Optional dependency directory allows reuse of the matching demo install.
const { build } = await import(process.argv[2] ? new URL('esbuild/lib/main.js', 'file:///' + process.argv[2].replaceAll('\\','/').replace(/\/?$/, '/')).href : 'esbuild');
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = dirname(fileURLToPath(import.meta.url));
await mkdir(resolve(root, 'assets'), { recursive: true });
// Preserve upstream component CSS inside the editor's component roots.
// The AZCine token bridge loaded after this file supplies the actual palette.
const sharedCSS = await readFile(resolve(root, 'vendor/packages/ui/src/styles/ui.css'), 'utf8');
const tokenCSS = await readFile(resolve(root, 'vendor/packages/ui/src/styles/tokens.css'), 'utf8');
const defaultTokens = tokenCSS.slice(tokenCSS.indexOf(':root {') + 7, tokenCSS.indexOf('}', tokenCSS.indexOf(':root {')));
const baseCSS = await readFile(resolve(root, 'vendor/packages/ui/src/styles/base-colors.css'), 'utf8');
// Preserve upstream's translucent callout fills. Opaque host surface tokens
// cover CodeMirror's selection layer behind the text.
const calloutDeclarations = css => (css.match(/^\s*--callout-[^\n]+/gm) || []).join('\n');
const darkStart = baseCSS.indexOf('[data-theme="dark"]');
// The first mention is in a comment; anchor the actual rule.
const darkRule = baseCSS.indexOf('\n[data-theme="dark"] {', darkStart);
const lightCallouts = calloutDeclarations(baseCSS.slice(0, darkRule));
const darkCallouts = calloutDeclarations(baseCSS.slice(darkRule));
const desktopCSS = await readFile(resolve(root, 'vendor/apps/desktop/src/App.css'), 'utf8');
const focusWidthCSS = desktopCSS.slice(desktopCSS.indexOf('.cm-editor.cm-focused,'), desktopCSS.indexOf('/*\n * Document header'))
  .replace('html[data-modality="keyboard"]', ':scope:where(html[data-modality="keyboard"] *)')
  .replace('.pv-cm-narrow .cm-content', ':scope.pv-cm-narrow .cm-content');
const selectionCSS = desktopCSS.slice(desktopCSS.indexOf('/* Editor text selection:'), desktopCSS.indexOf('/* .base viewer header:'));
const headerCSS = desktopCSS.slice(desktopCSS.indexOf('.pv-doc-header-stripe {'), desktopCSS.indexOf('/* Links inside rendered table cells'));
const readerCSS = desktopCSS.slice(desktopCSS.indexOf('.markdown-reader mark {'), desktopCSS.indexOf('/* Print / save as PDF'));
await writeFile(resolve(root, 'assets/upstream-ui.css'), `/* Original Plainva component styles, scoped by the AZCine host. */\n@scope (.plainva-host, .plainva-overlays, .plainva-chrome) {\n:scope {${defaultTokens}\n${lightCallouts}}\n:scope:where(html[data-theme="dark"] *) {${darkCallouts}}\n${sharedCSS}\n${focusWidthCSS}\n${selectionCSS}\n${headerCSS}\n${readerCSS}\n}\n`);
const result = await build({
  absWorkingDir: root, entryPoints: ['desktop-host.ts'], outfile: 'assets/editor.js',
  nodePaths: process.argv[2] ? [process.argv[2]] : [],
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
  minify: true, legalComments: 'linked', metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  alias: { '@plainva/core': resolve(root, 'core-entry.ts'), '@plainva/ui': resolve(root, 'ui-entry.ts'), '@tauri-apps/plugin-opener': resolve(root, 'reader-adapter.tsx') },
  plugins: [{ name: 'plainva-browser-adapters', setup(builder) {
    builder.onResolve({ filter: /(?:newItemFlow|activeDocument|templateInteractive|dailyNotes)$/ }, args => {
      if(args.importer.endsWith('TemplatePickerModal.tsx')) return { path: resolve(root, 'template-adapter.ts') };
    });
    builder.onResolve({ filter: /(?:VaultContext|useWikiResolver|contextMenuStore|BaseViewer)$/ }, args => {
      if(args.importer.includes('vendor')) return { path: resolve(root, 'reader-adapter.tsx') };
    });
    builder.onResolve({ filter: /(?:^|\/)i18n$/ }, args => {
      if(args.importer.includes('vendor')) return { path: resolve(root, 'i18n-adapter.ts') };
    });
    builder.onResolve({ filter: /AtMentionPlugin$/ }, args => {
      if(args.importer.endsWith('editorCompletion.ts')) return { path: resolve(root, 'mention-adapter.ts') };
    });
  } }],
});
await writeFile(resolve(root, 'assets/bundle-inputs.json'), JSON.stringify(result.metafile, null, 2) + '\n');
// Keep third-party licence texts beside the offline distributable.
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
let notices = 'Third-party dependency notices for the AZCine Plainva editor integration.\nPlainva: AGPL-3.0-only; see ../vendor/LICENSE and ../source-manifest.json.\n';
for(const [path, pkg] of Object.entries(lock.packages)) {
  if(!path.startsWith('node_modules/') || pkg.dev || pkg.optional) continue;
  notices += `\n\n--- ${path} @ ${pkg.version} (${pkg.license || 'see package source'}) ---\n`;
  for(const name of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','COPYING']) {
    try { notices += await readFile(resolve(process.argv[2] || resolve(root,'node_modules'),path.slice('node_modules/'.length),name),'utf8'); break; } catch { /* alternative package filename */ }
  }
}
await writeFile(resolve(root, 'assets/THIRD-PARTY-NOTICES.txt'), notices);
console.log('Plainva editor assets generated from the pinned upstream sources.');
