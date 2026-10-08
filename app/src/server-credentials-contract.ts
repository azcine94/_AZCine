import { localDate, validDate } from './workspace-contract.ts';

export type ManagerTab = 'servers' | 'credentials' | 'reminders';
export interface ServerRecord {
  id: string; name: string; provider: string; address: string; region: string;
  configuration: string; purpose: string; purchased: string; expires: string;
  price: string; currency: string; cycle: string; credentialId: string; notes: string;
  loginUsername: string; loginPassword: string;
}
export interface CredentialRecord {
  id: string; name: string; kind: 'password' | 'ssh'; category: string;
  username: string; password: string; website: string; publicFile: string;
  privateFile: string; publicFileId: string; privateFileId: string; passphrase: string; notes: string;
}
export function relativeDate(today: string, days: number) {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}
export function daysUntil(date: string, today: string) {
  if (!validDate(date) || !validDate(today)) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
export function expiryStatus(date: string, today: string) {
  if (!date) return { text: '未填到期日', tone: 'neutral' as const };
  const days = daysUntil(date, today);
  if (days === null) return { text: '日期异常，请检查', tone: 'error' as const };
  if (days < 0) return { text: `已过期 ${-days} 天`, tone: 'error' as const };
  if (days === 0) return { text: '今天到期', tone: 'warning' as const };
  if (days <= 7) return { text: `临近到期 · ${days} 天`, tone: 'warning' as const };
  if (days <= 30) return { text: `即将到期 · ${days} 天`, tone: 'warning' as const };
  return { text: `正常 · 剩余 ${days} 天`, tone: 'success' as const };
}
export const newServer = (): ServerRecord => ({ id: '', name: '', provider: '', address: '', region: '', configuration: '', purpose: '', purchased: '', expires: '', price: '', currency: 'CNY', cycle: '年付', credentialId: '', notes: '', loginUsername: '', loginPassword: '' });
export const newCredential = (): CredentialRecord => ({ id: '', name: '', kind: 'password', category: '网站', username: '', password: '', website: '', publicFile: '', privateFile: '', publicFileId: '', privateFileId: '', passphrase: '', notes: '' });
