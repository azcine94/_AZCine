# General personal project workspace references — round 2

日期：2026-10-01。用户原话：“都不好 都不贴切我的项目管理。。。 通用的个人项目管理有吗 再找找 去找图也行”。第一轮 Vikunja / Super Productivity / Kanboard 已否决。本轮不继续推荐纯任务清单，也不把“想看通用项目管理”擅自解释成确认新增画布、数据库或财务管理。

打开本目录 `index.html` 看图片对照。仅参考讨论，没有修改 `设计/v2/` 的 HTML / CSS / JS，也没有迁移旧目录。

## 1. Notion — project hub

来源页面：https://www.notion.com/templates/personal-project-management （实际 GET 200）。页面内 `__NEXT_DATA__` 的 template 字段标明名称 Project Management Hub、made_by=community；截图和头图来自同一模板，非相似推荐条目的图。模板有购买入口，本轮没有购买、复制付费模板或登录。

- `notion-project-hub.png`：https://s3-us-west-2.amazonaws.com/public.notion-static.com/92f04c37-ec18-460b-9f61-5a3904cc4330/ac76f839-e2bf-4d55-8d67-ac3d5ee4a6db.png
- `notion-project-hub-clean.jpg`：https://s3.us-west-2.amazonaws.com/public.notion-static.com/template/67f3644a-b9cb-42cd-861c-59539e85c519/1732275877575/desktop.jpg

两图均实际 GET 200、image MIME。主代理目视：第一张为模板作者带讲解预览，包含项目 / 任务 / 资料 / 笔记入口和项目状态；第二张是页面上部无讲解图，不声称是完整长页。Notion 是商业产品，仅图片参考，不称开源。

## 2. Milanote — visual project workspace

来源页面均 GET 200：
- https://milanote.com/templates/project-plans
- https://milanote.com/product/project-management
- https://milanote.com/templates/filmmaking

图片直接来自页面 `<img>`：
- `milanote-project-plan.png`：https://images.milanote.com/milanote/Zi8Zlt3JpQ5PTOvH_image-graphic-design-project-plan.png?w=2000&fm=png
- `milanote-film-project.png`：https://images.milanote.com/milanote/e133ae37-4bca-4045-8d52-f28e5b67a60c_Film-Mega-Guide-hero.png?w=2000&fm=png

均 GET 200，PNG，主代理已打开查看。可见项目说明、图片、待办、文件、子板和表格同处一板；影视图为官方模板，不代表用户真实项目。预算、评论、联系人、协作等不是AZCine新需求。Milanote 是商业产品，未安装或试用。

## 3. Anytype — personal project templates in a public GitHub gallery

来源：官方组织公开模板库 `anyproto/gallery`；模板是社区作者贡献，不冒充应用默认页面。

- 基础模板：https://github.com/anyproto/gallery/tree/main/experiences/project_management
- 元数据：https://raw.githubusercontent.com/anyproto/gallery/main/experiences/project_management/manifest.json
- 作者 geladariia，manifest 声明模板 MIT，描述明确 personal projects。
- `anytype-projects.png` / `anytype-project-detail.png` / `anytype-project-tasks.png` 依次下载自该目录 `screenshots/screenshot-1.png`、`screenshot-2.png`、`screenshot-3.png`（raw.githubusercontent.com，同上前缀）。全部200。第三张实际为作者结构讲解图，不是任务页面，未作为主图展示。
- 高级模板：https://github.com/anyproto/gallery/tree/main/experiences/advanced_project_management
- `anytype-project-overview.png` 来自该目录 `screenshots/screenshot-1.png`（200），可见项目、任务、周计划、笔记、书签、文档入口。
- `anytype-project-workspace.png` 来自该目录 `screenshots/screenshot-2.png`（200）；实际为概念层级图，不是应用页面，因此不展示为主界面。
- `anytype-para-project.png` 来自 https://raw.githubusercontent.com/anyproto/gallery/main/experiences/para_and_coder_setup/screenshots/screenshot-4.png （200）；实际为空列表与筛选教学图，不作为主要候选。

**许可区分**：模板manifest的MIT只针对模板。应用仓库 https://github.com/anyproto/anytype-ts/blob/develop/LICENSE.md 实际读取为 Any Source Available License 1.0，含用途 / 网络限制；不将其称为全套MIT开源软件，不因GitHub存在就推定任意商用或源码复用。这里只用模板截图观察。

## 4. AFFiNE — supplemental source-visible workspace

官网 https://affine.pro/ 与仓库README https://raw.githubusercontent.com/toeverything/AFFiNE/canary/README.md 实际200，介绍文档 / 画布 / 表格组合。

- `affine-planning.jpg`：https://affine.pro/overview/Plan.jpg （200）
- `affine-canvas.jpg`：https://affine.pro/overview/Draw.jpg （200）
- `affine-workspace.png`：https://cdn.affine.pro/Github_hero_image2.png （200）；目视只是Logo与平台宣传横幅，不用于界面推荐。

官网两张界面是含协作光标的局部宣传展示，不足以证明个人项目完整流程，故仅作补充折叠展示。仓库 LICENSE 实际读取说明后端 / native 等目录另有许可，其余部分MIT；不笼统声称所有代码MIT。

## Checked but not shortlisted

- `notion-simple-project.png`：从 https://www.notion.com/templates/simple-project-management 的screenshots字段取得，实际是自由职业者模板营销拼图，含CRM/财务等不必要部分，不作为主要选择。
- `acreom-projects.webp`：https://acreom.com/homepage/projects@2x.webp （200），官网引用；目视主要还是任务状态局部图，与用户刚否决的方向接近，不再重复推荐。
- 最初探测的 Milanote `/templates/projects/project-plan`、`/product/project-planning` 404；已通过其官方导航找到上述正确页面。Notion `/templates/projects-and-tasks` 和 Craft `/templates/project-management` 404，未宣称取得截图。

## Validation and boundaries

所有实际展示的图片均已由主代理通过 read 打开目视；不依据图名把营销图或结构图叫成真实应用操作页面。仅公开GET，没有安装、登录、调用模型或改宿主。图片版权属于原作者 / 产品方，不并入AZCine品牌或正式界面。

当前运行时未提供可调用的子代理 / delegate加载工具，因此本轮是主代理资料查证，不伪称独立scout审查。已有源图与许可链接可回查；参考选择仍待用户讨论。

新产物全英文命名。`downloads.json` 保留首批下载HTTP证据；本说明补充后续图片来源。参考页浏览器检查结果在 `reference-check.json`，不属于AZCine产品功能测试。
