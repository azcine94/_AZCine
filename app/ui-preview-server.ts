import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// 只发布本 Worktree 的预览地址，不登记固定端口，不读业务数据或认证。
export function uiPreviewServer(): Plugin {
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const id = createHash('sha256').update(workspace).digest('hex').slice(0,16);
  return {
    name: 'azcine-ui-overview-entry',
    transformIndexHtml(html, context) {
      if (!context.filename.endsWith('ui.html')) return html;
      return html.replace('<html ', `<html data-ui-worktree="${id}" `);
    },
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        if (!address || typeof address === 'string') return;
        const url = `http://127.0.0.1:${address.port}/ui.html`;
        const local = new URL('../.tooling/', import.meta.url);
        mkdirSync(local, {recursive:true});
        writeFileSync(new URL('ui-preview-url.js',local), `window.AZCINE_UI_OVERVIEW=${JSON.stringify({url,workspace:id})};\n`);
        server.config.logger.info(`独立 UI 总览：${url}（也可打开 Worktree 根目录 index.html）`);
      });
    },
  };
}
