import { useEffect, useRef, useState } from 'react';
import { notifyOperation } from './components/ui/operation-toast.tsx';
import { invoke, isTauri } from './desktop-api.ts';
import { workspaceError } from './workspace-contract.ts';
import { defaultLogoOptions, logoFileIssue, logoFileType, logoView, parseBrandLogo, trimTransparentMargins } from './branding-contract.ts';
import type { BrandLogoView, LogoOptions } from './branding-contract.ts';

export interface BrandingController {
  /** null = bundled default logo. */
  logo: BrandLogoView | null;
  loaded: boolean; busy: boolean; error: string;
  save(file: File): Promise<void>;
  setOptions(patch: Partial<LogoOptions>): Promise<void>;
  reset(): Promise<void>;
}

export function useBranding(root: string | null): BrandingController {
  const [logo, setLogo] = useState<BrandLogoView | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setLoaded(false);
    if (!root || !isTauri()) { setLogo(null); setError(''); return; }
    void (async () => {
      try {
        const record = parseBrandLogo(await invoke('branding_logo'));
        if (generation.current !== current) return;
        setLogo(logoView(record)); setError('');
      } catch (cause) {
        if (generation.current !== current) return;
        // Keep the bundled logo visible; the settings page shows why the custom one did not load.
        setError(workspaceError(cause));
      } finally { if (generation.current === current) setLoaded(true); }
    })();
  }, [root]);
  async function run(label: string, work: () => Promise<{ logo: BrandLogoView | null; done: string }>) {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const result = await work();
      if (generation.current !== current) return;
      setLogo(result.logo); notifyOperation(result.done);
    } catch (cause) {
      if (generation.current === current) setError(`${label}失败：${workspaceError(cause)}`);
    } finally { if (generation.current === current) setBusy(false); }
  }
  const options = (): LogoOptions => logo ? { invertDark: logo.invertDark, invertLight: logo.invertLight, scale: logo.scale } : defaultLogoOptions;
  return {
    logo, loaded, busy, error,
    save: async file => {
      const issue = logoFileIssue(file);
      if (issue) { setError(issue); return; }
      await run('更换 Logo', async () => {
        const prepared = await trimTransparentMargins(file, logoFileType(file)!);
        const bytes = Array.from(new Uint8Array(await prepared.blob.arrayBuffer()));
        const record = parseBrandLogo(await invoke('branding_save_logo', { input: { name: file.name, mediaType: prepared.mediaType, bytes, ...options() } }));
        return { logo: logoView(record), done: prepared.trimmed ? '品牌 Logo 已更换，并裁掉了透明边距。' : '品牌 Logo 已更换。' };
      });
    },
    setOptions: async patch => {
      if (!logo) return;
      const next = { ...options(), ...patch };
      await run('更新显示设置', async () => ({ logo: logoView(parseBrandLogo(await invoke('branding_logo_options', { options: next }))), done: 'Logo 显示设置已保存。' }));
    },
    reset: async () => { await run('恢复默认 Logo', async () => { await invoke('branding_clear_logo'); return { logo: null, done: '已恢复默认 Logo。' }; }); },
  };
}
