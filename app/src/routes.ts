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
export type Route = PageId | `projects/${string}` | `ideas/${string}` | `today/${string}` | 'missing';
const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const projectPattern = new RegExp(`^projects/(${uuidPattern})(?:/(${uuidPattern})/(${uuidPattern}))?$`);
const sourcePattern = new RegExp(`^(ideas|today)/(${uuidPattern})$`);
export function resolveRoute(hash: string): Route {
  const id = hash.replace(/^#/, '') || 'today';
  if (id === 'projects/new' || projectPattern.test(id)) return id as `projects/${string}`;
  if (sourcePattern.test(id)) return id as `ideas/${string}` | `today/${string}`;
  return pages.some(page => page.id === id) ? id as PageId : 'missing';
}
export function projectTarget(route: Route): { projectId: string; row?: { blockId: string; rowId: string } } | null {
  const match = projectPattern.exec(route);
  return match ? { projectId: match[1], row: match[2] ? { blockId: match[2], rowId: match[3] } : undefined } : null;
}
export function sourceTarget(route: Route): string | null { return sourcePattern.exec(route)?.[2] ?? null; }
export function navigationPage(route: Route): PageId | 'missing' { return route === 'projects/new' || projectPattern.test(route) ? 'projects' : sourcePattern.test(route) ? sourcePattern.exec(route)![1] as PageId : route as PageId | 'missing'; }
export function pageTitle(route: Route): string {
  if (route === 'projects/new') return '新建公司项目';
  if (projectPattern.test(route)) return '公司文档';
  if (sourcePattern.test(route)) return sourcePattern.exec(route)![1] === 'ideas' ? '灵感' : '今天';
  return pages.find(page => page.id === route)?.title || '页面不存在';
}
