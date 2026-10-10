/** Strict, bounded USTAR reader for Joplin JEX. No extraction or platform I/O. */
export const JEX_LIMITS = { maxEntries: 20_000, maxEntryBytes: 32 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024, maxTextEntryBytes: 2 * 1024 * 1024, maxTextBytes: 64 * 1024 * 1024 };
export interface TarSource { size: number; read(offset: number, length: number): Promise<Uint8Array> }
export interface TarEntry { relativePath: string; offset: number; size: number; mtimeMs?: number }
export interface ArchiveReadControl { signal?: AbortSignal; onProgress?: (percent: number) => void }
export function checkArchiveAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
}
const invalid = (): never => { throw new Error('import.archiveInvalid'); };
const tooLarge = (): never => { throw new Error('import.archiveTooLarge'); };
const decoder = new TextDecoder('utf-8', { fatal: true });
function text(bytes: Uint8Array): string {
  const zero = bytes.indexOf(0);
  if (zero >= 0 && bytes.slice(zero).some(b => b !== 0)) invalid();
  try { return decoder.decode(zero < 0 ? bytes : bytes.slice(0, zero)); } catch { return invalid(); }
}
function octal(bytes: Uint8Array): number {
  const value = decoder.decode(bytes).replace(/\0/g, '').trim();
  if (!/^[0-7]*$/.test(value)) invalid();
  const n = value ? parseInt(value, 8) : 0;
  if (!Number.isSafeInteger(n)) invalid();
  return n;
}
/** Portable filenames: one archive must have the same meaning on both shells. */
export function safeTarPath(raw: string): string {
  const path = raw.replace(/\\/g, '/');
  if (!path || path.startsWith('/') || path.length > 1024) return invalid();
  const parts = path.split('/');
  // eslint-disable-next-line no-control-regex -- Control bytes are forbidden in portable archive paths.
  if (parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f\x7f<>:"|?*]/.test(p) || /[ .]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) return invalid();
  return path;
}
/** Reads headers in slices; callers can keep attachment bodies on disk/in a Blob. */
export async function readTarEntries(source: TarSource, control: ArchiveReadControl = {}, limits = JEX_LIMITS): Promise<TarEntry[]> {
  if (!Number.isSafeInteger(source.size) || source.size < 1024 || source.size % 512) invalid();
  if (source.size > limits.maxTotalBytes + limits.maxEntries * 1024 + 10240) tooLarge();
  const read = async (offset: number, length: number) => {
    checkArchiveAbort(control.signal);
    const bytes = await source.read(offset, length);
    checkArchiveAbort(control.signal);
    if (bytes.length !== length) invalid();
    return bytes;
  };
  const entries: TarEntry[] = [], seen = new Map<string, boolean>(), descendants = new Set<string>();
  let offset = 0, total = 0, count = 0;
  while (offset + 512 <= source.size) {
    const header = await read(offset, 512);
    if (header.every(b => b === 0)) {
      if (offset + 1024 > source.size) invalid();
      for (let tail = offset + 512; tail < source.size; tail += 65536) {
        if ((await read(tail, Math.min(65536, source.size - tail))).some(b => b !== 0)) invalid();
      }
      control.onProgress?.(100);
      return entries;
    }
    if (++count > limits.maxEntries) tooLarge();
    const sum = header.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
    if (sum !== octal(header.slice(148, 156))) invalid();
    const magic = decoder.decode(header.slice(257, 263));
    if (magic !== 'ustar\0' && magic !== 'ustar ' && magic !== '\0\0\0\0\0\0') invalid();
    let raw = text(header.slice(0, 100));
    const prefix = magic === 'ustar\0' ? text(header.slice(345, 500)) : '';
    if (prefix) raw = `${prefix}/${raw}`;
    const type = header[156], dir = type === 53;
    if (type !== 0 && type !== 48 && !dir) invalid(); // links, devices, sparse files and extensions
    const size = octal(header.slice(124, 136));
    if (size > limits.maxEntryBytes || total + size > limits.maxTotalBytes) tooLarge();
    if (dir && size) invalid();
    const relativePath = safeTarPath(dir ? raw.replace(/\/$/, '') : raw);
    const key = relativePath.normalize('NFC').toLowerCase();
    if (seen.has(key)) invalid();
    const parents = key.split('/');
    parents.pop();
    while (parents.length) {
      const parent = parents.join('/');
      if (seen.get(parent) === false) invalid();
      descendants.add(parent); parents.pop();
    }
    if (!dir && descendants.has(key)) invalid();
    seen.set(key, dir);
    total += size;
    const dataOffset = offset + 512;
    offset = dataOffset + Math.ceil(size / 512) * 512;
    if (offset > source.size) invalid();
    const seconds = octal(header.slice(136, 148));
    if (!dir) entries.push({ relativePath, offset: dataOffset, size, mtimeMs: seconds && Number.isSafeInteger(seconds * 1000) ? seconds * 1000 : undefined });
    control.onProgress?.(Math.min(99, Math.floor(offset / source.size * 100)));
  }
  return invalid();
}
