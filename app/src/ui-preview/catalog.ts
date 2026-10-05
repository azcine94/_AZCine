import { pages, pageTitle } from '../routes.ts';
import type { Route } from '../routes.ts';
import { settingsGroups } from '../settings-navigation.ts';
import { processingPhases } from '../news-processing-client.ts';
import {readerArticleId,readerStoryId} from './news-reader-fixture.ts';
import { statusLabels } from '../news-contract.ts';
import { project, event, source, idea, uuid } from './data.ts';

export interface Scene {id:string;title:string;group:string;route:Route|null;states:string[];sources:string[]}
const base = ['normal','empty','loading','error','long','root-error','shell-collapsed'];
export const extraStateLabels:Record<string,string>={
  'shell-collapsed':'整站 · 侧栏收起',
  'agent-more':'Agent · 更多会话操作展开','agent-runtime':'Agent · 运行信息展开','agent-models':'Agent · 多模型菜单展开','agent-sessions':'Agent · 多会话列表','agent-process':'Agent · 思考与工具过程展开',
  'provider-interface':'模型 · 接口设置展开','provider-fetching':'服务商 · 获取模型中','provider-saving':'服务商 · 保存中','provider-multiple':'多个服务商 / 多个模型',
  'stage-select':'阶段 · 选择展开','stage-create':'阶段 · 新增标签','stage-manage':'阶段 · 管理标签','stage-rename':'阶段 · 改名','stage-error':'阶段 · 输入错误',
  'calendar-open':'日期 · 日历展开','table-menu':'表格 · 操作菜单展开','add-menu':'项目 · 添加内容菜单展开',
  'table-stage-menu':'表格 · 阶段列菜单','table-date-menu':'表格 · 日期列菜单','table-delivered-menu':'表格 · 已交完列菜单','table-text-menu':'表格 · 文本列菜单','table-row-menu':'表格 · 行菜单',
  'folds-open':'当前内容 · 折叠详情展开','dialog-open':'通用对话框展开','popover-open':'通用浮层展开','dropdown-open':'通用操作菜单展开','tooltip-open':'通用提示展开',
  'conflict':'版本冲突 / 保留草稿','conflict-details':'版本冲突 · 当前正式内容展开','discard-confirm':'项目 · 放弃草稿确认','create-pending':'项目 · 创建回执待核对','project-undo':'项目 · 删除后可撤销','project-saving':'项目 · 保存中',
  'retry-confirm':'任务 · 重试原任务确认','tool-daily':'其他处理 · 生成日报','tool-analysis':'其他处理 · 事件分析','tool-skill':'其他处理 · Skill（未接入）','original-source':'资讯 · 订阅原文','input-details':'处理 · 原始输入展开','response-details':'处理 · 模型返回展开','all-scope':'处理 · 全部待处理范围',
};
export const stateLabels: Record<string,string> = {'root-error':'数据目录读取失败',removed:'已移除的灵感',converted:'已转为待办',undo:'可撤销状态',normal:'正常内容',empty:'空内容',loading:'读取中',error:'失败 / 保留内容',long:'长文本',dirty:'未保存草稿',pending:'保存回执待核对',editing:'编辑中','no-root':'未选择数据目录',paused:'暂停信源',preview:'信源预览',proxy:'手动代理配置',remote:'获取到远程模型',models:'服务商模型列表',advanced:'服务商高级设置',busy:'刷新中',disconnected:'未连接 Pi',review:'需要核对',incomplete:'日报覆盖不完整',detail:'批次详情',success:'成功样式（虚构）',all:'全部动态',featured:'精选',hot:'热点',daily:'固定日报',filtered:'领域筛选后无结果',attachments:'消息附件',compacting:'整理上下文',...statusLabels,...processingPhases};
const files: Record<string,string[]> = {
  today:['workspace-panels.tsx','projects-panels.tsx','news-reading-panels.tsx'],
  projects:['projects-panels.tsx'],
  news:['news-reader-panels.tsx','news-article-body.tsx','news-reading-panels.tsx'],models:['model-ranking-panel.tsx'],ideas:['ideas-panels.tsx'],
  agent:['pi-agent-panel.tsx','pi-agent-demo.tsx','pi-process-panel.tsx','pi-panels.tsx'],
  jobs:['news-processing-panel.tsx'],settings:['settings-panels.tsx'],
  'settings/models':['pi-provider-panel.tsx','pi-panels.tsx'],
  'settings/runtime':['pi-panels.tsx'],'settings/data':['workspace-panels.tsx'],
  'settings/news':['news-panels.tsx'],'settings/news/materials':['news-panels.tsx'],
  'settings/news/processing':['news-processing-panel.tsx'],'settings/news/rules':['news-preferences-panel.tsx'],
  'settings/news/ai':['news-preferences-panel.tsx'],'settings/news/automation':['news-preferences-panel.tsx'],
};
function states(route:string) {
  if (route==='jobs'||route==='settings/news/processing') return [...base,'detail',...Object.keys(processingPhases),'all-scope','retry-confirm','tool-daily','tool-analysis','tool-skill','input-details','response-details'];
  if (route==='settings/news') return [...base,'paused',...Object.keys(statusLabels),'folds-open'];
  if (route==='settings/models') return [...base,'dirty','models','advanced','remote','disconnected','provider-interface','provider-fetching','provider-saving','provider-multiple'];
  if (route==='settings/news/automation') return [...base,'dirty','pending','proxy','folds-open'];
  if(route==='settings/news/ai'||route==='settings/news/rules')return [...base,'dirty','pending','folds-open'];
  if (route==='settings'||route==='settings/skills'||route==='settings/extensions') return ['normal','disconnected','long'];
  if (route==='settings/diagnostics') return ['normal','loading','error','success'];
  if (route==='settings/runtime') return ['normal','disconnected','connecting','error','long','folds-open'];
  if (route==='agent') return [...base,'disconnected','connecting','running','interrupted','queued','attachments','compacting','agent-more','agent-runtime','agent-models','agent-sessions','agent-process'];
  if (route==='news') return [...base,'all','featured','hot','daily','filtered','review','incomplete'];
  if (route==='ideas'||route.startsWith('ideas/')) return [...base,'editing','pending','removed','converted','undo','conflict','conflict-details'];
  if(route==='projects/new')return [...base,'dirty','create-pending'];
  if(route.startsWith('projects/'))return [...base,'dirty','pending','conflict','conflict-details','discard-confirm','project-undo','project-saving','table-menu','table-stage-menu','table-date-menu','table-delivered-menu','table-text-menu','table-row-menu','add-menu','stage-select','stage-create','stage-manage','stage-rename','stage-error','calendar-open'];
  if(route.startsWith('news/events/'))return [...base,'original-source','folds-open'];
  if (route==='today') return [...base,'pending','completed','undo','no-root'];
  if (route==='models') return [...base,'busy','no-root'];
  return [...base,'dirty','pending','no-root'];
}
function scene(route:Route,title:string,group:string,sources:string[] = files[route]??[]):Scene {
  return {id:route,title,group,route,states:[...new Set(states(route))],sources:['main.tsx','App.tsx','workspace-header.tsx',...(route.startsWith('settings')?['settings-panels.tsx']:[]),...sources]};
}
export const scenes:Scene[] = [
  {id:'components',title:'通用组件与项目控件',group:'UI 基础',route:null,states:['normal','error','loading','long','stage-select','stage-create','stage-manage','stage-rename','stage-error','calendar-open','table-menu','add-menu','folds-open','dialog-open','popover-open','dropdown-open','tooltip-open'],sources:['date-input.tsx','project-stage-picker.tsx','table-menu.tsx','project-add-menu.tsx']},
  ...pages.filter(page=>page.id!=='settings').map(page=>scene(page.id,page.title,'主页面')),
  ...settingsGroups.flatMap(group=>group.items.map(item=>scene(item.route,item.title,`设置 / ${group.title}`))),
  scene('projects/new','新建公司项目','详情与编辑',['projects-panels.tsx']),
  scene(`projects/${project.id}`,'项目文档 · 文字 / 清单 / 表格','详情与编辑',['projects-panels.tsx','project-list-editor.tsx','project-checklist-panel.tsx','project-stage-picker.tsx','project-add-menu.tsx','table-menu.tsx','date-input.tsx']),
  scene(`projects/${project.id}/${uuid(8)}/${uuid(20)}`,'交付定位到表格行','详情与编辑',['projects-panels.tsx','project-list-editor.tsx']),
  scene(`news/events/${event.id}`,'旧事件链接 → 统一文章详情','详情与编辑',['news-reader-panels.tsx','news-article-body.tsx']),
  scene(`news/items/${readerArticleId}`,'资讯文章 · 正文与阅读目录','详情与编辑',['news-reader-panels.tsx','news-article-body.tsx']),
  scene(`news/stories/${readerStoryId}`,'资讯事件 · 报道与进展','详情与编辑',['news-reader-panels.tsx']),
  scene('settings/news/sources/new','新增信源','详情与编辑',['news-panels.tsx']),
  scene(`settings/news/sources/${source.config.id}`,'编辑信源与预览','详情与编辑',['news-panels.tsx']),
  scene(`ideas/${idea.id}`,'定位灵感卡片','详情与编辑',['ideas-panels.tsx']),
  scene(`today/${uuid(50)}`,'定位待办','详情与编辑',['workspace-panels.tsx']),
  scene('news/materials','旧资料入口 → 采集资料','边界与别名',['news-panels.tsx']),
  scene('missing','不存在的页面','边界与别名'),
];
const sourceStates = ['normal','dirty','pending','loading','error','long','preview','folds-open'];
for (const item of scenes) if (item.id.startsWith('settings/news/sources/')) item.states=sourceStates;

// 直接枚举当前源码；新增页面/组件但未登记会在总览提示，不能静默从清单消失。
export const pageSources = import.meta.glob<string>(['../**/*.tsx','!../components/ui/**','!../ui-preview/**'],{query:'?raw',import:'default',eager:true});
export const componentSources = import.meta.glob<string>('../components/ui/**/*.tsx',{query:'?raw',import:'default',eager:true});
export const styleSources = import.meta.glob<string>(['../styles/*.css','../components/ui/*.css'],{query:'?raw',import:'default',eager:true});
export const sourceFiles = Object.keys(pageSources).map(path=>path.replace('../',''));
export const unregisteredSources = sourceFiles.filter(name=>!scenes.some(item=>item.sources.includes(name)));
export const routeLabels = (route:string) => pageTitle(route as Route);
Object.assign(stateLabels,extraStateLabels);
