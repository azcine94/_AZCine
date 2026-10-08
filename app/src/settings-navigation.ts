export const settingsGroups = [
  { title: '通用与外观', items: [
    { route: 'settings', title: '常用设置', icon: 'appearance' },
  ] },
  { title: '模型与 Agent', items: [
    { route: 'settings/models', title: '模型服务商', icon: 'model' },
    { route: 'settings/runtime', title: '工作目录与环境', icon: 'folder' },
  ] },
  { title: '资讯管理', items: [
    { route: 'settings/news', title: '信源管理', icon: 'source' },
    { route: 'settings/news/materials', title: '采集资料', icon: 'source' },
    { route: 'settings/news/processing', title: '处理与记录', icon: 'clock' },
    { route: 'settings/news/rules', title: '分类与筛选', icon: 'filter' },
    { route: 'settings/news/ai', title: 'AI 处理', icon: 'model' },
    { route: 'settings/news/automation', title: '采集与日报', icon: 'clock' },
  ] },
  { title: '数据', items: [
    { route: 'settings/data', title: '数据目录', icon: 'folder' },
  ] },
  { title: '高级与诊断', items: [
    { route: 'settings/about', title: '关于与更新', icon: 'clock' },
    { route: 'settings/diagnostics', title: '桌面连接检查', icon: 'diagnostics' },
  ] },
] as const;

export type SettingsRoute = typeof settingsGroups[number]['items'][number]['route'];
export type SettingsIconName = typeof settingsGroups[number]['items'][number]['icon'] | 'extension' | 'skill';
type SettingsItem = typeof settingsGroups[number]['items'][number];
export const settingsItems = settingsGroups.flatMap<SettingsItem>(group => [...group.items]);

export function settingsRoute(value: string): SettingsRoute | null {
  return settingsItems.find(item => item.route === value)?.route ?? null;
}

export function settingsTitle(value: string): string | null {
  return settingsItems.find(item => item.route === value)?.title ?? null;
}
