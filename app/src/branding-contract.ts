export const logoMediaTypes = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/svg+xml': 'SVG' } as const;
export type LogoMediaType = keyof typeof logoMediaTypes;
export const LOGO_MAX_BYTES = 1024 * 1024;
export const logoAccept = Object.keys(logoMediaTypes).concat('.svg').join(',');

/** Percent of the sidebar's 56px lockup height. */
export const logoScales = [{ value: 75, label: '小' }, { value: 100, label: '标准' }, { value: 125, label: '大' }, { value: 150, label: '特大' }] as const;
export type LogoScale = typeof logoScales[number]['value'];
export interface LogoOptions { invertDark: boolean; invertLight: boolean; scale: LogoScale }
export const defaultLogoOptions: LogoOptions = { invertDark: false, invertLight: false, scale: 100 };
export interface BrandLogoRecord extends LogoOptions { mediaType: LogoMediaType; name: string; bytes: number[] }
/** Resolved for display: the data URL is built once per record, never re-read from disk per render. */
export interface BrandLogoView extends LogoOptions { url: string; name: string; mediaType: LogoMediaType }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function isLogoMediaType(value: unknown): value is LogoMediaType { return typeof value === 'string' && Object.hasOwn(logoMediaTypes, value); }
export function isLogoScale(value: unknown): value is LogoScale { return logoScales.some(scale => scale.value === value); }

export function parseBrandLogo(value: unknown): BrandLogoRecord | null {
  if (value === null || value === undefined) return null;
  if (!object(value) || !isLogoMediaType(value.mediaType) || typeof value.name !== 'string' || typeof value.invertDark !== 'boolean' || typeof value.invertLight !== 'boolean' || !isLogoScale(value.scale)
    || !Array.isArray(value.bytes) || value.bytes.length < 1 || value.bytes.length > LOGO_MAX_BYTES) throw Error('品牌 Logo 回执格式不完整，未替换当前显示。');
  return { mediaType: value.mediaType, name: value.name, bytes: value.bytes as number[], invertDark: value.invertDark, invertLight: value.invertLight, scale: value.scale };
}

export function logoDataUrl(mediaType: LogoMediaType, bytes: ArrayLike<number>): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...Array.prototype.slice.call(bytes, i, i + 8192));
  return `data:${mediaType};base64,${btoa(binary)}`;
}

export function logoView(record: BrandLogoRecord | null): BrandLogoView | null {
  return record && { url: logoDataUrl(record.mediaType, record.bytes), name: record.name, mediaType: record.mediaType, invertDark: record.invertDark, invertLight: record.invertLight, scale: record.scale };
}

/** Bounding box of non-transparent pixels, with a small margin; null when there is nothing to trim. */
export function opaqueBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 8): { x: number; y: number; w: number; h: number } | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] <= threshold) continue;
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  if (right < 0) return null;
  const margin = Math.round(Math.max(right - left, bottom - top) * 0.04);
  const x = Math.max(0, left - margin), y = Math.max(0, top - margin);
  const w = Math.min(width, right + 1 + margin) - x, h = Math.min(height, bottom + 1 + margin) - y;
  // Only worth re-encoding when the margins are a meaningful share of the image.
  if (w * h > width * height * 0.9) return null;
  return { x, y, w, h };
}

/** Crop transparent padding from raster logos so the artwork, not its canvas, fills the sidebar slot. */
export async function trimTransparentMargins(file: File, mediaType: LogoMediaType): Promise<{ blob: Blob; mediaType: LogoMediaType; trimmed: boolean }> {
  const original = { blob: file as Blob, mediaType, trimmed: false };
  if (mediaType === 'image/svg+xml' || mediaType === 'image/jpeg' || typeof createImageBitmap !== 'function') return original;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return original;
    context.drawImage(bitmap, 0, 0);
    const bounds = opaqueBounds(context.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height);
    bitmap.close?.();
    if (!bounds) return original;
    const cropped = document.createElement('canvas');
    cropped.width = bounds.w; cropped.height = bounds.h;
    cropped.getContext('2d')?.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    const blob = await new Promise<Blob | null>(resolve => cropped.toBlob(resolve, 'image/png'));
    if (!blob || blob.size > LOGO_MAX_BYTES) return original;
    return { blob, mediaType: 'image/png', trimmed: true };
  } catch { return original; }
}

/** Accept by declared type, falling back to the extension for SVG files Windows reports without a MIME type. */
export function logoFileType(file: File): LogoMediaType | null {
  if (isLogoMediaType(file.type)) return file.type;
  if (!file.type && /\.svg$/i.test(file.name)) return 'image/svg+xml';
  return null;
}
export function logoFileIssue(file: File): string {
  if (!logoFileType(file)) return '只支持 PNG、JPEG、WebP 或 SVG 图片。';
  if (file.size < 1) return '所选文件为空。';
  if (file.size > LOGO_MAX_BYTES) return '图片需不超过 1 MB。';
  return '';
}
