import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { uiPreviewServer } from './ui-preview-server.ts';
import { uiInventory } from './ui-inventory.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), uiPreviewServer(), uiInventory()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/', import.meta.url)) } },
  cacheDir: fileURLToPath(new URL('../.tooling/vite-cache/', import.meta.url)),
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2023' },
});
