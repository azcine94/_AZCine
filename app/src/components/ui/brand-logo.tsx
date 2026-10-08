import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import './brand-logo.css';

// Bundled assets only: no requests to company sites when rendering a saved board.
const assets = import.meta.glob<string>('../../assets/brands/*.{svg,png}', { eager: true, query: '?url', import: 'default' });
const brands: Record<string, { asset: string; name: string }> = {
  anthropic: { asset: 'claude-color.svg', name: 'Anthropic' },
  openai: { asset: 'openai.svg', name: 'OpenAI' },
  google: { asset: 'google-color.svg', name: 'Google' },
  meta: { asset: 'meta-color.svg', name: 'Meta' },
  xai: { asset: 'xai.svg', name: 'xAI' },
  microsoft: { asset: 'microsoft-color.svg', name: 'Microsoft' },
  deepseek: { asset: 'deepseek-color.svg', name: 'DeepSeek' },
  moonshot: { asset: 'moonshot.svg', name: 'Moonshot' },
  bytedance: { asset: 'bytedance-color.svg', name: 'ByteDance' },
  alibaba: { asset: 'alibaba-color.svg', name: 'Alibaba' },
  tencent: { asset: 'tencent-color.svg', name: 'Tencent' },
  minimax: { asset: 'minimax-color.svg', name: 'MiniMax' },
  mistral: { asset: 'mistral-color.svg', name: 'Mistral AI' },
  stepfun: { asset: 'stepfun-color.svg', name: 'StepFun' },
  upstage: { asset: 'upstage-color.svg', name: 'Upstage' },
  xiaomi: { asset: 'xiaomi-color.svg', name: 'Xiaomi' },
  zai: { asset: 'zai.svg', name: 'Z.ai' },
  bfl: { asset: 'bfl.svg', name: 'Black Forest Labs' },
  hidream: { asset: 'hidream.png', name: 'HiDream' },
  ideogram: { asset: 'ideogram.svg', name: 'Ideogram' },
  krea: { asset: 'krea.svg', name: 'Krea' },
  luma: { asset: 'luma-color.svg', name: 'Luma AI' },
  nvidia: { asset: 'nvidia-color.svg', name: 'NVIDIA' },
  recraft: { asset: 'recraft.svg', name: 'Recraft' },
  reve: { asset: 'reve.svg', name: 'Reve' },
};
const aliases: Record<string, string> = {
  microsoftai: 'microsoft', moonshotai: 'moonshot', mistralai: 'mistral',
  blackforestlabs: 'bfl', lumai: 'luma', lumaai: 'luma',
  hidreamai: 'hidream', zhipu: 'zai', zhipuai: 'zai', zhipuaiglobal: 'zai',
  alibabacloud: 'alibaba', googledeepmind: 'google',
};
function brandFor(organization: string | null) {
  const key = (organization ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const canonical = Object.hasOwn(aliases, key) ? aliases[key] : key;
  return Object.hasOwn(brands, canonical) ? brands[canonical] : undefined;
}

export function brandName(organization: string | null) {
  return (brandFor(organization)?.name ?? organization?.trim()) || '厂商未提供';
}

/** Decorative companion to a visible company/model name. Unknown names stay neutral. */
export function BrandLogo({ organization, size = 'sm', className }: {
  organization: string | null; size?: 'sm' | 'md'; className?: string;
}) {
  const brand = brandFor(organization);
  const src = brand && assets[`../../assets/brands/${brand.asset}`];
  return <span className={cn('ui-brand-logo', className)} data-size={size} data-native-mono={Boolean(src && brand && brand.asset.endsWith('.svg') && !brand.asset.endsWith('-color.svg'))} aria-hidden="true">
    {src ? <img src={src} alt="" width={32} height={32} draggable={false} />
      : <Building2 className="ui-brand-logo-fallback" />}
  </span>;
}
