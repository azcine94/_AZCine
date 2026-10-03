"""One-time, authorized directory migration. Does not overwrite files or discard evidence.
Run without arguments to plan; --apply executes the reviewed map and saves a snapshot.
"""
from pathlib import Path
import hashlib, json, re, sys, zipfile
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'research/migration'
EXACT = {
 '产品需求文档.md':'requirements.md','设计规范.md':'design-spec.md','direction-approved.md':'decisions.md',
 '工作台.html':'workbench.html','日报打印.html':'daily-print.html','旧版审阅入口-已否决.html':'review-index-rejected.html','需求落点与验收.md':'requirements-coverage.md',
 'AIHOT参考调研.md':'aihot-source-research.md','AIHOT资讯改稿依据.md':'aihot-news-design.md','Skill适配独立复核.md':'skill-adapter-review.md',
 'v2导航与灵感草稿修复.md':'navigation-and-idea-draft-fixes.md','v2项目三级结构落地.md':'project-hierarchy-history.md','夜间自主推进记录.md':'overnight-decisions.md',
 '子代理启动诊断.md':'subagent-startup-diagnostics.md','设计信息架构建议原报告.md':'information-architecture-report.md','设计独立复核-第一轮.md':'design-review-round-1.md',
 '设计规范-v1-已否决.md':'design-spec-v1-rejected.md','非Electron技术查证原报告.md':'non-electron-feasibility-report.md',
 '截图像素测量.json':'screenshot-measurements.json','浏览器验收.json':'browser-report.json','运行日志.txt':'run.log','验证说明.md':'validation-notes.md',
 '首屏历史运行日志.txt':'home-history.log','首屏历史验收.json':'home-history-report.json','verify-首屏历史.cjs':'verify-home-history.cjs','资讯阅读尺寸.json':'news-reading-dimensions.json',
 '参考说明.md':'README.md','AIHOT-计算样式.json':'aihot-computed-styles.json','出厂kit.png':'factory-kit.png',
 '首屏对比入口.png':'direction-index.png','灵感新增草稿恢复-修复.png':'idea-new-draft-restored.png','灵感编辑草稿-修复.png':'idea-edit-draft-fixed.png'
}
WORDS = [
 ('Agent-过程与结果','agent-process-result'),('事件-来源与分析','event-sources-analysis'),('资料变更-待确认','import-pending'),
 ('整期摘要','daily-digest'),('演示-文本','demo-text'),('演示','demo'),('日报一致性','daily-consistency'),('AI日报','ai-daily'),
 ('亮暗对照','theme-comparison'),('新闻正文','news-reader'),('资讯列表','news-feed'),('资料核对','import-check'),('镜头列表','shot-list'),('镜头详情','shot-detail'),
 ('项目入口','project-index'),('项目跨年','project-cross-year'),('首页跨年','home-cross-year'),('审阅入口','review-index'),
 ('镜头任务','shot-tasks'),('镜头管理','shot-tracking'),('项目概览','project-overview'),('项目看板','project-board'),('任务看板','task-board'),('任务更新','task-update'),
 ('里程碑','milestones'),('审阅','review'),('列表','list'),('浅色','light'),('深色','dark'),('灵感','ideas'),('日报','daily'),('资讯','news'),('项目','project'),('打印','print')
]
def english(name):
 if name in EXACT: return EXACT[name]
 m=re.fullmatch(r'方向([ABC])(?:-(制作桌面|日刊优先|场记分栏))?\.html',name)
 if m:return 'workspace-'+m[1].lower()+'.html'
 name=re.sub(r'方向([ABC])',lambda m:'direction-'+m[1].lower(),name)
 for old,new in WORDS:name=name.replace(old,new)
 if not name.isascii():raise ValueError('Unmapped non-ASCII name: '+name)
 return name

def destination(old):
 parts=old.parts
 if len(parts)==1 and old.name in ['产品需求文档.md','设计规范.md','direction-approved.md']:return Path('docs')/english(old.name)
 if parts[0]=='调研':return Path('research/reports')/english(old.name)
 if parts[0]=='.playwright-mcp':return Path('archive/evidence/browser-research')/old.name
 if parts[0]=='设计':
  if len(parts)>2 and parts[1]=='v2':
   if parts[2]=='截图':return Path('archive/evidence/v2-iterations/screenshots')/english(old.name)
   if parts[2]=='验证':return Path('archive/evidence/v2-iterations/validation')/english(old.name)
   if parts[2]=='参考':return Path('research/references/aihot')/english(old.name)
   return Path('design')/english(old.name)
  if len(parts)>2 and parts[1]=='参考':return Path('research/project-references/legacy-production-tools')/english(old.name)
  sub={'截图':'screenshots','验证':'validation'}.get(parts[1],'')
  return Path('archive/design-v1')/sub/english(old.name)
 return Path(*(english(p) for p in parts))

files=sorted(p for p in ROOT.rglob('*') if p.is_file())
entries=[]
for p in files:
 old=p.relative_to(ROOT)
 if old.parts[:2]==('research','migration') or old.name=='pre-migration-snapshot.zip':continue
 target=destination(old)
 entries.append({'old':old.as_posix(),'new':target.as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
seen={}
for e in entries:
 key=e['new'].lower()
 if key in seen:raise ValueError(f"Collision: {seen[key]} / {e['old']} -> {key}")
 seen[key]=e['old']
 if e['old']!=e['new'] and (ROOT/e['new']).exists():raise ValueError('Destination exists: '+e['new'])
OUT.mkdir(parents=True,exist_ok=True)
manifest=OUT/'path-map.json'
if manifest.exists():raise SystemExit('Manifest already exists; do not rerun. Use saved path-map.json.')
manifest.write_text(json.dumps({'status':'planned','entries':entries},ensure_ascii=False,indent=2),encoding='utf8')
print('Inventoried',len(entries),'files;',sum(e['old']!=e['new'] for e in entries),'moves; collision check passed')
if '--apply' not in sys.argv:raise SystemExit('Plan saved. Apply via separate approval command using the saved map.')
raise SystemExit('Apply is intentionally separate; use the saved manifest after inspection.')
