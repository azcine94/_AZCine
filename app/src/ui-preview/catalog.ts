import { pages, pageTitle } from '../routes.ts';
import type { Route } from '../routes.ts';
import { settingsGroups } from '../settings-navigation.ts';
import { processingPhases } from '../news-processing-client.ts';
import {readerArticleId,readerStoryId} from './news-reader-fixture.ts';
import { statusLabels } from '../news-contract.ts';
import { bookkeepingExampleId } from './bookkeeping-fixture.ts';
import { project, event, source, idea, uuid } from './data.ts';

export interface Scene {id:string;title:string;group:string;route:Route|null;states:string[];sources:string[]}
const base = ['normal','empty','loading','error','long','root-error','shell-collapsed'];
const agentRepairStates=['agent-draft-create','agent-draft-update','agent-draft-long','agent-draft-confirm','agent-draft-conflict','agent-process-retry','agent-process-nested','agent-process-nested-running','agent-process-nested-error','agent-answer-table'];
export const extraStateLabels:Record<string,string>={
  'task-panel-delivery-user-required':'任务面板 · 本人明确确认的必做检查未通过',
  'task-panel-graph-loading':'任务面板 · 关系图首次加载','task-panel-graph-empty':'任务面板 · 关系图空范围','task-panel-graph-error':'任务面板 · 关系图读取失败','task-panel-delivery-unverified':'任务面板 · 验收未验证交付','task-panel-delivery-required':'任务面板 · Agent 报告检查不强制阻止验收','task-panel-delivery-stale':'任务面板 · 交付证据已过期','task-panel-delivery-long':'任务面板 · 长文本验收','task-panel-delivery-error':'任务面板 · 验收失败保留输入',
  'today-news-many':'今天 · 最多10条资讯与内部滚动','today-news-long':'今天 · 资讯长标题换行','today-news-empty':'今天 · 日报无条目','today-news-loading':'今天 · 资讯读取中','today-news-error':'今天 · 资讯失败保留内容',
  'agent-cold-history':'Agent · 查看历史无需启动进程','agent-lazy-start':'Agent · 首次发送按需连接','agent-connect-error':'Agent · 连接失败保留文字与附件',
  'agent-process-nested':'Agent · 子调用归入同一已工作','agent-process-nested-running':'Agent · 子调用执行中','agent-process-nested-error':'Agent · 父调用完成但子调用失败',
  'agent-draft-create':'Agent · 新建项目表格预览','agent-draft-update':'Agent · 行与单元格差异','agent-draft-long':'Agent · 长草案与表格分页','agent-draft-confirm':'Agent · 固定底栏确认应用','agent-draft-conflict':'Agent · 草案过期保留内容','agent-process-retry':'Agent · 单轮重试与子调用状态','agent-answer-table':'Agent · 回答中的表格',
  'agent-sidebar':'Agent侧栏 · 正常聊天','agent-sidebar-sessions':'Agent侧栏 · 会话列表与关闭','agent-sidebar-long':'Agent侧栏 · 长标题和正文','agent-sidebar-running':'Agent侧栏 · 正在回复','agent-sidebar-extension':'Agent侧栏 · 等待回答','agent-sidebar-error':'Agent侧栏 · 失败保输入',
  'task-panel-branches':'任务面板 · 总仓库与任务分支',
  'task-panel-task-flow':'任务面板 · 前置、当前与下游任务','task-panel-records':'任务面板 · 具名检查与交付文件','task-panel-records-history':'任务面板 · 历史批次与较早记录折叠','task-panel-records-unnamed':'任务面板 · 未注明检查名称','task-panel-records-long':'任务面板 · 长检查命令与文件名称',
  'task-panel-feedback-pending':'任务面板 · 补充意见待发送','task-panel-feedback-response':'任务面板 · Agent 回应','task-panel-revision-edit':'任务面板 · 修改要求前核对停止','task-panel-worktree-retry':'任务面板 · 任务已保存与分支重试','task-panel-draft-restored':'任务面板 · 恢复未提交草案','task-panel-workspace-unavailable':'任务面板 · 单个执行目录异常','task-panel-checks-stale':'任务面板 · 旧检查不用于当前版本',
  'task-panel-overview':'任务面板 · 项目总控与全部任务','task-panel-overview-selected':'任务面板 · 选择任务保持总览','task-panel-overview-long':'任务面板 · 总览长任务与长分支',
  'task-panel-total-git':'任务面板 · 未选任务显示总仓库','task-panel-no-code':'任务面板 · 所选任务无代码工作区',
  'task-panel-branch-clean':'任务面板 · 任务分支干净','task-panel-branch-pending':'任务面板 · 分支状态待同步','task-panel-branch-error':'任务面板 · 分支读取失败','task-panel-branch-stale':'任务面板 · 分支观察过期','task-panel-branch-long':'任务面板 · 长分支名称',
  'task-panel-syncing':'任务面板 · 固定同步提示与刷新保内容','task-panel-initial-sync':'任务面板 · 首次同步','task-panel-sync-error':'任务面板 · 同步失败保内容','task-panel-project-manager':'任务面板 · 项目管理','task-panel-project-delete-confirm':'任务面板 · 项目删除确认','task-panel-project-deleted':'任务面板 · 已删除项目与恢复','task-panel-project-delete-error':'任务面板 · 删除失败保记录',
  'task-panel-task-content':'任务面板 · 清晰的任务内容','task-panel-task-protocol':'任务面板 · 旧交接协议折叠与完整原文',
  'task-panel-create':'任务面板 · 自然语言新建任务','task-panel-create-manual':'任务面板 · 手动新建任务','task-panel-refining':'任务面板 · Agent 细化中与取消','task-panel-refine-questions':'任务面板 · Agent 追问与回答','task-panel-refine-ready':'任务面板 · 细化草案核对','task-panel-refine-error':'任务面板 · 细化失败保输入','task-panel-refine-stale':'任务面板 · 需求变化待重新细化','task-panel-refine-no-model':'任务面板 · 未配置细化模型','task-panel-refine-long':'任务面板 · 长需求与长 Prompt',
  'task-panel-code-graph':'任务面板 · 代码结构图','task-panel-graph-long':'任务面板 · 关系图长名称',
  'task-panel-project':'任务面板 · 项目归属','task-panel-multiple-projects':'任务面板 · 多项目','task-panel-context':'任务面板 · 上下文预览','task-panel-memory-reference':'任务面板 · Agent 参考','task-panel-memory-pending':'任务面板 · 待确认决定',
  'form-dialog-open':'创建表单弹窗展开','form-dialog-error':'创建弹窗 · 失败保留输入','form-dialog-pending':'创建弹窗 · 回执待核对','form-dialog-loading':'创建弹窗 · 保存中','form-dialog-long':'创建弹窗 · 长输入','operation-toast':'右上角操作提示','history-delete':'删除单条处理记录','history-clear':'清空已结束记录','bookkeeping-validation':'记账 · 字段校验不重复','bookkeeping-create':'记一笔弹窗','bookkeeping-edit':'编辑开销弹窗','bookkeeping-save-feedback':'记账 · 保存反馈稳定','bookkeeping-refresh':'记账 · 刷新保留旧内容','bookkeeping-refresh-fast':'记账 · 短刷新不闪提示','project-create':'新建项目弹窗','todo-create':'新增待办弹窗','idea-create':'新灵感弹窗','source-create':'新增信源弹窗',
  'project-delete-confirm':'项目 · 整项目删除确认','project-removed':'项目 · 已删除与撤销','project-restore-confirm':'项目 · 恢复确认','project-delete-pending':'项目 · 删除回执待核对','project-delete-error':'项目 · 删除失败保留内容',
  'month-open':'月份 · 中文选择展开','bookkeeping-fx':'记账 · 外币折算','bookkeeping-fx-loading':'记账 · 汇率读取中','bookkeeping-fx-error':'记账 · 汇率失败保留输入',
  'bookkeeping-selected':'记账 · 勾选合计','bookkeeping-confirm':'记账 · 报销确认','bookkeeping-delete':'记账 · 移除确认','bookkeeping-saving':'记账 · 保存中',
  'resource-waiting':'资源 · 等待 Pi 操作完成',
  'agent-session-status':'Agent · 会话状态圆点',
  'agent-session-pinned':'Agent · 独立置顶分类','agent-session-manage':'Agent · 最近会话批量管理入口','agent-session-pin-action':'Agent · 会话行悬停置顶入口',
  'windows-paths':'Windows 路径 · 本机与共享目录',
  'shell-collapsed':'整站 · 侧栏收起',
  'agent-waiting':'Agent · 等待模型响应','agent-delete':'Agent · 删除会话确认','agent-bulk-delete':'Agent · 会话批量管理','agent-sessions-collapsed':'Agent · 会话分组收起','todo-delete':'今天 · 删除待办确认','agent-objects':'Agent · 真实对象选择与搜索','agent-draft-review':'Agent · 草案核对','agent-draft-decisions':'Agent · 确定变更与待确认事项','agent-extension':'Agent · 原生扩展问题','agent-more':'Agent · 更多会话操作展开','agent-runtime':'Agent · 运行信息展开','agent-models':'Agent · 多模型菜单展开','agent-sessions':'Agent · 多会话列表','agent-process':'Agent · 思考与工具过程展开',
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
  'task-panel':['task-panel-panels.tsx','task-panel-observation.tsx','task-panel-create-dialog.tsx','use-task-refinement.ts','task-panel-task-content.tsx','task-panel-task-records.tsx','task-panel-graph.tsx','task-panel-graph-layout.ts','task-panel-workflow.tsx','task-panel-project-view.tsx'],
  bookkeeping:['bookkeeping-panels.tsx'],
  today:['workspace-panels.tsx','projects-panels.tsx','today-news-panel.tsx'],
  projects:['projects-panels.tsx'],
  news:['news-reader-panels.tsx','news-article-body.tsx','news-reading-panels.tsx'],models:['model-ranking-panel.tsx'],ideas:['ideas-panels.tsx'],
  agent:['components/ui/attachment-preview.tsx','agent-image-limits.ts','agent-object-picker.tsx','agent-drafts-panel.tsx','agent-draft-preview.tsx','pi-extension-panel.tsx','agent-sidebar.tsx','agent-session-navigation.tsx','use-agent-session-pins.ts','components/ui/status-dot.tsx','pi-agent-panel.tsx','pi-agent-demo.tsx','pi-process-panel.tsx','pi-process-view.ts','pi-messages.ts','agent-message-content.ts','agent-draft-review.ts','components/ui/message-markdown.tsx','pi-panels.tsx'],
  jobs:['agent-jobs-panel.tsx','news-processing-panel.tsx'],settings:['settings-panels.tsx'],
  'settings/models':['pi-provider-panel.tsx','pi-panels.tsx'],
  resources:['pi-resources-panel.tsx'],
  'settings/runtime':['pi-panels.tsx'],'settings/data':['workspace-panels.tsx'],
  'settings/news':['news-panels.tsx'],'settings/news/materials':['news-panels.tsx'],
  'settings/news/processing':['news-processing-panel.tsx'],'settings/news/rules':['news-preferences-panel.tsx'],
  'settings/news/ai':['news-preferences-panel.tsx'],'settings/news/automation':['news-preferences-panel.tsx'],
};
function states(route:string) {
  if (route==='task-panel') return [...base,'task-panel-delivery-user-required','task-panel-graph-loading','task-panel-graph-empty','task-panel-graph-error','task-panel-delivery-unverified','task-panel-delivery-required','task-panel-delivery-stale','task-panel-delivery-long','task-panel-delivery-error','task-panel-feedback-pending','task-panel-feedback-response','task-panel-revision-edit','task-panel-worktree-retry','task-panel-draft-restored','task-panel-workspace-unavailable','task-panel-checks-stale','task-panel-syncing','task-panel-initial-sync','task-panel-sync-error','task-panel-project-manager','task-panel-project-delete-confirm','task-panel-project-deleted','task-panel-project-delete-error','task-panel-create','task-panel-create-manual','task-panel-refining','task-panel-refine-questions','task-panel-refine-ready','task-panel-refine-error','task-panel-refine-stale','task-panel-refine-no-model','task-panel-refine-long','task-panel-task-content','task-panel-task-protocol','task-panel-branches','task-panel-total-git','task-panel-no-code','task-panel-branch-clean','task-panel-branch-pending','task-panel-branch-error','task-panel-branch-stale','task-panel-branch-long','dirty','pending','conflict','task-panel-editor','task-panel-intake','task-panel-intake-launch','task-panel-graph','task-panel-task-flow','task-panel-overview','task-panel-overview-selected','task-panel-overview-long','task-panel-records','task-panel-records-history','task-panel-records-unnamed','task-panel-records-long','task-panel-code-graph','task-panel-graph-long','task-panel-memory','task-panel-sessions','task-panel-goal','task-panel-dispatch','task-panel-import','task-panel-delivery','task-panel-recovery','task-panel-project','task-panel-multiple-projects','task-panel-context','task-panel-memory-reference','task-panel-memory-pending','task-panel-start-failed','task-panel-paused','task-panel-cancelled','task-panel-stopping','task-panel-stop-confirm'];
  if (route==='bookkeeping'||route.startsWith('bookkeeping/')) return [...base,'dirty','pending','filtered','conflict','undo','bookkeeping-selected','bookkeeping-confirm','bookkeeping-delete','bookkeeping-saving',...(route==='bookkeeping'?['month-open','bookkeeping-validation','bookkeeping-create','bookkeeping-edit','bookkeeping-save-feedback','bookkeeping-refresh','bookkeeping-refresh-fast']:[]),'bookkeeping-fx','bookkeeping-fx-loading','bookkeeping-fx-error'];
  if (route==='jobs'||route==='settings/news/processing') return [...base,'detail','history-delete','history-clear',...Object.keys(processingPhases),'all-scope','retry-confirm','tool-daily','tool-analysis','tool-skill','input-details','response-details'];
  if (route==='settings/news') return [...base,'source-create','paused',...Object.keys(statusLabels),'folds-open'];
  if (route==='settings/models') return [...base,'dirty','models','advanced','remote','disconnected','provider-interface','provider-fetching','provider-saving','provider-multiple'];
  if (route==='settings/news/automation') return [...base,'dirty','pending','proxy','folds-open'];
  if(route==='settings/news/ai'||route==='settings/news/rules')return [...base,'dirty','pending','folds-open'];
  if (route==='resources') return [...base,'editing','dirty','disconnected','connecting','resource-waiting','windows-paths'];
  if (route==='settings') return ['normal','disconnected','long'];
  if (route==='settings/diagnostics') return ['normal','loading','error','success'];
  if (route==='settings/runtime') return ['normal','disconnected','connecting','error','long','folds-open','windows-paths'];
  if (route==='agent') return [...base,...agentRepairStates,'agent-cold-history','agent-lazy-start','agent-connect-error','disconnected','connecting','running','interrupted','queued','attachments','compacting','agent-waiting','agent-delete','agent-objects','agent-draft-review','agent-extension','agent-more','agent-runtime','agent-models','agent-sessions','agent-session-status','agent-session-pinned','agent-session-manage','agent-session-pin-action','agent-bulk-delete','agent-sessions-collapsed','agent-draft-decisions','agent-process'];
  if (route==='news') return [...base,'all','featured','hot','daily','filtered','review','incomplete'];
  if (route==='ideas'||route.startsWith('ideas/')) return [...base,'idea-create','editing','pending','removed','converted','undo','conflict','conflict-details'];
  if(route==='projects')return [...base,'project-create','dirty','create-pending','project-delete-confirm','project-removed','project-restore-confirm','project-delete-pending','project-delete-error'];
  if(route==='projects/new')return [...base,'dirty','create-pending'];
  if(route.startsWith('projects/'))return [...base,'project-delete-confirm','project-removed','project-restore-confirm','project-delete-pending','project-delete-error','dirty','pending','conflict','conflict-details','discard-confirm','project-undo','project-saving','table-menu','table-stage-menu','table-date-menu','table-delivered-menu','table-text-menu','table-row-menu','add-menu','stage-select','stage-create','stage-manage','stage-rename','stage-error','calendar-open'];
  if(route.startsWith('news/events/'))return [...base,'original-source','folds-open'];
  if (route==='today') return [...base,'today-news-many','today-news-long','today-news-empty','today-news-loading','today-news-error','agent-sidebar','agent-sidebar-sessions','agent-sidebar-long','agent-sidebar-running','agent-sidebar-extension','agent-sidebar-error','agent-draft-review','todo-create','todo-delete','pending','completed','undo','no-root'];
  if (route==='models') return [...base,'busy','no-root'];
  return [...base,'dirty','pending','no-root'];
}
function scene(route:Route,title:string,group:string,sources:string[] = files[route]??[]):Scene {
  return {id:route,title,group,route,states:[...new Set(states(route))],sources:['main.tsx','App.tsx','workspace-header.tsx','loading-status.tsx',...(route.startsWith('settings')?['settings-panels.tsx']:[]),...sources]};
}
export const scenes:Scene[] = [
  {id:'components',title:'通用组件与项目控件',group:'UI 基础',route:null,states:['normal','operation-toast','error','loading','long','stage-select','stage-create','stage-manage','stage-rename','stage-error','calendar-open','month-open','table-menu','add-menu','folds-open','dialog-open','form-dialog-open','form-dialog-error','form-dialog-pending','form-dialog-loading','form-dialog-long','popover-open','dropdown-open','tooltip-open'],sources:['components/ui/operation-toast.tsx','components/ui/operation-toast.css','components/ui/form-dialog.tsx','components/ui/form-dialog.css','date-input.tsx','project-stage-picker.tsx','table-menu.tsx','project-add-menu.tsx']},
  ...pages.filter(page=>page.id!=='settings').map(page=>scene(page.id,page.title,'主页面')),
  ...settingsGroups.flatMap(group=>group.items.map(item=>scene(item.route,item.title,`设置 / ${group.title}`))),
  scene('projects/new','新建公司项目 · 弹窗','创建弹窗',['projects-panels.tsx']),
  scene('bookkeeping/new','记账 · 记一笔弹窗','创建弹窗',['bookkeeping-panels.tsx']),
  scene(`bookkeeping/${bookkeepingExampleId}`,'记账 · 编辑开销与票据弹窗','编辑弹窗',['bookkeeping-panels.tsx']),
  scene(`projects/${project.id}`,'项目文档 · 文字 / 清单 / 表格','详情与编辑',['projects-panels.tsx','project-list-editor.tsx','project-checklist-panel.tsx','project-stage-picker.tsx','project-add-menu.tsx','table-menu.tsx','date-input.tsx']),
  scene(`projects/${project.id}/${uuid(8)}/${uuid(20)}`,'交付定位到表格行','详情与编辑',['projects-panels.tsx','project-list-editor.tsx']),
  scene(`news/events/${event.id}`,'旧事件链接 → 统一文章详情','详情与编辑',['news-reader-panels.tsx','news-article-body.tsx']),
  scene(`news/items/${readerArticleId}`,'资讯文章 · 正文与阅读目录','详情与编辑',['news-reader-panels.tsx','news-article-body.tsx']),
  scene(`news/stories/${readerStoryId}`,'资讯事件 · 报道与进展','详情与编辑',['news-reader-panels.tsx']),
  scene('settings/news/sources/new','新增信源 · 弹窗','创建弹窗',['news-panels.tsx']),
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
