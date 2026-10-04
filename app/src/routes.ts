import { settingsRoute, settingsTitle } from './settings-navigation.ts';
import type { SettingsRoute } from './settings-navigation.ts';

export const pages = [
  { id: 'today', title: '今天', icon: 'today' },
  { id: 'projects', title: '项目', icon: 'projects' },
  { id: 'news', title: '资讯', icon: 'news' },
  { id: 'models', title: '模型榜', icon: 'models' },
  { id: 'ideas', title: '灵感', icon: 'ideas' },
  { id: 'agent', title: 'Agent', icon: 'agent' },
  { id: 'jobs', title: '后台任务', icon: 'jobs' },
  { id: 'settings', title: '设置', icon: 'settings' },
] as const;

export type PageId = typeof pages[number]['id'];
export type Route = PageId | SettingsRoute | `projects/${string}` | 'news/materials' | `news/events/${string}` | `settings/news/sources/${string}` | `ideas/${string}` | `today/${string}` | 'missing';
const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const projectPattern = new RegExp(`^projects/(${uuidPattern})(?:/(${uuidPattern})/(${uuidPattern}))?$`);
const newsSourcePattern = new RegExp(`^settings/news/sources/(new|rss-[a-z0-9-]{1,96}|${uuidPattern})$`);
const sourcePattern = new RegExp(`^(ideas|today)/(${uuidPattern})$`);
export function resolveRoute(hash: string): Route {
  const id = hash.replace(/^#/, '') || 'today';
  if (id === 'projects/new' || projectPattern.test(id)) return id as `projects/${string}`;
  const setting = settingsRoute(id);
  if (setting) return setting;
  if (id === 'news/materials') return 'settings/news/materials';
  if (/^news\/events\/[a-f0-9]{64}$/.test(id)) return id as `news/events/${string}`;
  if (newsSourcePattern.test(id)) return id as `settings/news/sources/${string}`;
  if (sourcePattern.test(id)) return id as `ideas/${string}` | `today/${string}`;
  return pages.some(page => page.id === id) ? id as PageId : 'missing';
}
export function projectTarget(route: Route): { projectId: string; row?: { blockId: string; rowId: string } } | null {
  const match = projectPattern.exec(route);
  return match ? { projectId: match[1], row: match[2] ? { blockId: match[2], rowId: match[3] } : undefined } : null;
}
export function newsSourceTarget(route: Route): string | null { return newsSourcePattern.exec(route)?.[1] ?? null; }
export function navigationPage(route: Route): PageId | 'missing' {
  if (route === 'projects/new' || projectPattern.test(route)) return 'projects';
  if (settingsRoute(route) || newsSourcePattern.test(route)) return 'settings';
  if (route === 'news/materials' || route.startsWith('news/events/')) return 'news';
  if (sourcePattern.test(route)) return sourcePattern.exec(route)![1] as PageId;
  return route as PageId | 'missing';
}
export function sourceTarget(route: Route): string | null { return sourcePattern.exec(route)?.[2] ?? null; }
export function pageTitle(route: Route): string {
  const setting = settingsTitle(route);
  if (setting) return setting;
  if (route === 'news/materials') return '采集资料';
  if (route.startsWith('news/events/')) return '事件详情';
  if (newsSourcePattern.test(route)) return route.endsWith('/new') ? '新增信源' : '编辑信源';
  if (route === 'projects/new') return '新建公司项目';
  if (projectPattern.test(route)) return '公司文档';
  if (sourcePattern.test(route)) return sourcePattern.exec(route)![1] === 'ideas' ? '灵感' : '今天';
  return pages.find(page => page.id === route)?.title || '页面不存在';
}
