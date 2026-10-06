// Presentation only. Keep native paths unchanged for IPC and file operations.
export function displayPath(value: string): string {
  const prefix = '\\\\?\\';
  if (!value.startsWith(prefix)) return value;
  const path = value.slice(prefix.length);
  if (/^UNC\\/i.test(path)) return `\\\\${path.slice(4)}`;
  return /^[a-z]:\\/i.test(path) ? path : value;
}
