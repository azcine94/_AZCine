/* 总览入口标记为 UI fixture。即使在桌面 WebView 打开，也禁止触达业务 IPC。 */
import { invoke as tauriInvoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

const preview = () => typeof document !== 'undefined' && document.documentElement.dataset.uiPreview === 'true';
export const isTauri = () => !preview() && tauriIsTauri();
export const invoke: typeof tauriInvoke = <T>(command: Parameters<typeof tauriInvoke>[0], args?: Parameters<typeof tauriInvoke>[1], options?: Parameters<typeof tauriInvoke>[2]) => preview()
  ? Promise.reject(new Error('UI 总览使用虚构资料，不执行桌面操作。'))
  : tauriInvoke<T>(command, args, options);
export const listen: typeof tauriListen = (event, handler, options) => preview()
  ? Promise.resolve(() => {}) : tauriListen(event, handler, options);
