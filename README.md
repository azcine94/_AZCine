# AZCine

Windows 个人影视 CG + AI coding 工作台，采用 Tauri 2 / React / TypeScript / Rust / 独立纯上游 Pi。

## Windows v0.1.0

<!-- release-notes:0.1.0 -->
AZCine 首个 Windows x64 安装版。下载 `AZCine_0.1.0_x64-setup.exe` 安装；其他资产供应用更新及文件校验使用。仅提供 Windows，不提供 macOS/Linux/ARM 安装包。

- 集成今天/待办、公司项目、资讯、模型榜、灵感、记账、服务器和凭证，以及 Agent、任务面板和开发环境工具。
- 正式版和开发版分开保存实例定位与 Pi 状态；新安装没有个人业务记录，首次选择专用数据目录。建议使用文档目录下的 `AZCineData-Release`，不要选择开发版正在使用的目录。
- “设置 → 数据目录”可迁移到新空目录，或切换已有目录；重新启动生效，旧目录保留。关闭应用后可自行用 OneDrive 搬运整根，新电脑完整下载后重新选择。
- 随包提供独立 Node 24.21.0 和纯上游 Pi 1.0.4。模型认证由本人配置；个人 Skills/扩展不预装。外部项目、Herdr/Codex/OpenPI及其环境需要另外准备。
- “设置 → 关于与更新”显示当前版本，支持手动检查、下载、签名校验及确认安装重启。更新保留独立数据目录，安装前请保存编辑并结束任务。

验证范围：虚构数据的目录迁移/切换/恢复、原生 Pi 会话重开，以及两版已签名 Windows 安装包之间的更新已实测；真实 OneDrive 云端、第二台实体电脑及付费模型效果未验证。导入核对、完整 PDF 阅读导出、托盘/自启等未完成能力不在本版承诺内。

安装包使用 Tauri 更新签名，未购买 Windows 发布者证书，系统可能显示“未知发布者”。推荐使用默认安装位置，过深的自定义安装路径可能触发 Windows 安装器路径限制。
<!-- release-notes:end -->

正式下载入口：[GitHub Releases](https://github.com/azcine94/_AZCine/releases)。

### 后续发布与恢复

版本与更新说明随代码通过 PR 合并到 `main` 后，在 Actions 手动运行 `Windows release`，输入匹配的 `vX.Y.Z`。工作流只接受当前 main、未使用的标签和一致版本，检查通过后生成 Windows NSIS、更新签名、`latest.json` 与 `SHA256SUMS.txt`，先上传草稿再公开。发布签名私钥由维护者离线保管，GitHub 仅存 Secret；后续版本必须沿用同一把密钥。

安装前正常退出并保留数据副本。出现问题时先保留当前数据，优先发布版本号更高的修复版；手动恢复旧程序时同时使用与旧版兼容的数据副本，不强行用旧程序打开已迁移的新库。v0.1.0 没有更早的正式版可回退。

## 本地运行

开发版与正式安装版已配置为不同应用标识：开发版保留现有数据，正式版首次启动点击“选择目录”后“使用此目录”，建议目录为系统文档目录下的 `AZCineData-Release`，也可指定其他专用目录。两者分别使用 `%LOCALAPPDATA%/com.azcine.workbench/` 与 `%LOCALAPPDATA%/com.azcine.workbench.release/` 下的定位配置及实例锁；选择不同业务根才能同时使用，手动选择同根仍会互斥。已用隔离身份的release安装包和虚构数据验证迁移、切换及全新本机配置恢复；正常开发/正式标识的双开未专门验证，尚未发版。

目录选错后，在“设置 → 数据目录 → 更改数据目录”选择：迁移当前数据到新空目录，或切换到已有AZCine数据目录。保存后可取消，正常退出并重新打开才执行；迁移会复制并核对文件、生成SQLite一致快照，成功后切换本机定位，旧根始终保留。切换不会合并两份记录，失败继续使用原目录并显示原因。

换机流程：旧电脑正常退出AZCine → 完整目录同步至OneDrive → 新电脑完整下载该目录 → 安装AZCine → 首次选择已有数据目录。正式Pi的配置、认证、会话、Skills与扩展在 `<数据根>/pi/`，随用户选择的整根搬运一起携带；程序与Node/Pi runtime随安装包提供。换机时应用会调整自己数据根内的会话路径，保留调整前原生会话副本；外部项目/工具/Skills绝对路径需在新电脑自行重选，不会猜测。仓库任务面板位于所选外部总仓库，不属于此数据根，仓库需另外带走。

OneDrive传输由用户操作，本应用不提供多机合并；不要两台电脑同时编辑，也不要边运行边上传活跃库。可将下载目录设为[始终保留在此设备上](https://learn.microsoft.com/en-us/onedrive/files-on-demand-windows)，在应用关闭后等待同步完成，打开时暂停同步，关闭后再恢复同步。该设置本身不保证数据库一致性，参见 [SQLite文件复制限制](https://www.sqlite.org/howtocorrupt.html)。整根搬运会包含认证；这与以后排除认证的自动备份是不同操作。真实OneDrive云端传输尚未实测。

本地构建安装包使用 `npm run build:desktop`。使用本仓库工具链与锁定的应用runtime生成Windows NSIS安装包；构建前检查runtime入口哈希，缺资源或锁不一致时停止。此命令不推送、不打标签或发布Release。远端PR与正式发版仍单独执行。

在项目根目录执行：

```sh
npm run dev
```

打开真实 Tauri 桌面窗口。正常开发读取原应用的数据目录定位配置，使用同一份原main业务库，不自动创建本目录专用数据库。可保存待办、完成/恢复，管理公司项目文档、文字/list/勾选清单、项目标签、独立交期和指定 list 的交付汇总；大表按 100 行分页。模型榜已接入Agent与文生图Overall各前50的自动获取/保存及Agent输入输出价格。资讯已接18个RSS/Atom信源管理、手动采集、原版Pi整理/分析；日报下拉/日期/同日版本、整期复制/Markdown导出已接回，旧PDF基础保留但新阅读页完整PDF入口仍待接续。灵感支持保存编辑、筛选、删除撤销及防重转待办。模型榜/资讯/灵感的旧版限定集成验证保留原范围；2026-10-06 polish的统一UI库、资讯新处理/阅读链和规则资源基础已完整合入本地main，最新代码未重验。资讯模型效果仅用显式回放，正式用户验收未确认。导入核对尚未接入，个人项目内部待定。

2026-10-06 `polish/dev-2@d7ae820` 已快进合入本地main：导航新增“记账”，支持开销、人民币合计、外币报价快照、报销状态、票据副本及CSV导出；创建/开销编辑使用共享弹窗，操作短提示统一自动消失，项目可删除恢复，已结束资讯处理记录可移出历史。当前提交未运行测试、类型检查、构建、启动或UI验证。

2026-10-07 `feat/agent-dev@62c93dc` 三个提交已快进合入本地main：应用MCP/业务草案、限定后台任务、会话与附件、生命周期、今日资讯及嵌套工具归组已接。**main自有runtime已按用户要求替换为Pi1.0.4 / Node24.21.0，旧0.99.1运行目录已删除。** 复用本仓库Agent分支的匹配安装资源，核对官方归档1248文件、入口与安装锁哈希及全部复制文件，未修改Pi核心或默认提示。配置/认证/会话与业务数据未改，未启动应用或运行测试；已有进程仍需正常退出后从main根重新 `npm run dev` 才使用新版本。Git不包含runtime二进制；新环境的安装工具 `scripts/prepare-pi-runtime.py` 生成候选与proposed lock，不自动部署main。

2026-10-07 `feat/kanban-dev@83342ac` 已合入本地main，工具区新增“任务面板”：选择一个总仓库管理任务/项目/架构/记忆，任务分支只作为执行位置，不另开项目或切换看板。状态与交接产物在所选总仓库 `.azcine/task-panel/`，权威任务库为 `state.sqlite3`；开发分支位于该总仓库 `.azcine/worktrees/`。可保存与手工核对任务；自动建窗格/启动/派发需本机已有Herdr CLI及对应PowerShell中的 `codex` 或 `opi`，Archify默认路径 `E:/skills-manager/archify`，缺工具明确提示。这里的Codex/OpenPI执行与应用自有Pi聊天runtime是不同入口，不更新其宿主配置或安装环境。本轮未打开任务库、归并用户记录、操作窗格或运行验证。

独立Worktree也在各自根目录使用同一条 `npm run dev`，打开所在目录的版本，不要求指定模块。流程仍为独立分支开发、交接后合main；后续从最新main开始打磨，业务数据库共用原应用定位配置，Windows位置为 `%LOCALAPPDATA%/com.azcine.workbench/data-root.json`。本机当前原数据根是 `C:/Users/A/Documents/AZCineData`，业务库是其 `db/azcine.sqlite3`；源码不写死该机器路径。缺原定位配置或数据被另一窗口占用时明确报错，不回退新空库。当前只能一个桌面窗口持有库锁，先关闭另一窗口再打开分支。

当前源码数据库版本为16，含记账/外币/项目删除/资讯历史隐藏及Agent记录/后台上下文/会话软删除/待办软删除迁移；本轮合并未打开或迁移真实库。新版应用启动后若将共享库升级，旧schema12及更早程序将拒绝该库；切回旧源码不能降级数据。其他开发Worktree使用共享库前须按各自授权同步兼容源码，不复制、覆盖或自动重建原库。

正常开发的Pi配置、认证、会话、Skills和扩展共用本仓库main的 `.tooling/dev-instance/data/pi/`；启动器从Git common-dir自动定位main并传共享参数，不运行PATH中的其他Pi。Skills放 `agent/skills/<name>/SKILL.md`，用户扩展放 `agent/extensions/`，可在“工具 → 规则与资源”查看。既有进程需正常结束后在其Worktree根重新 `npm run dev` 才生效，缺共享参数明确报错。明确测试根和正式版不用开发共享覆盖，也不自动迁移旧Pi文件。各Worktree主窗口的WebView使用 `.tooling/dev-instance/webview/`（仅主窗口dataDirectory覆盖，公开取文窗口可用独立环境），Vite缓存使用 `.tooling/vite-cache/`；明确测试根继续隔离。旧分支数据库和原Pi目录全部保留，本次不复制/合并/迁移数据。旧源码分支须带上最新main的数据入口改动才使用这套行为，不跨目录改其源码。启动器自动检测可用端口、同步Vite/Tauri devUrl与CSP，并有限重试端口竞争；配置/业务根/Pi根/端口/自有PID打印并保存于不入Git的 `.tooling/instance/run-state.json`，启动锁防同目录重复运行。远程调试默认关闭。旧独立库入口的验证记录不覆盖新共用库入口；polish整分支合并时未运行测试、构建或真实启动；本次缺依赖修复后的正常启动另列于本页末尾，范围见[开发计划](docs/development-plan.md)。

Pi 模型设置和 Agent 页面已挂入口，但 S03 整链路验证与独立复核尚未完成；没有模型不会生成假回复。主窗关闭目前退出。资讯本地自动采集和北京时间日报调度已接，默认关闭、仅电脑及应用实际运行时执行；限定summarize-text/summarize-batch/draft-objects任务与日志/取消已接；任意任务、完整父子委派、托盘和登录自启仍留待。当前实际进度、留待和暂停点分别看[开发计划](docs/development-plan.md)与[当前工作](docs/current-work.md)，不把可运行等同全产品完成。

| 命令 | 用途 |
|---|---|
| `npm run dev:web` | 仅网页预览，无桌面 IPC/数据库能力 |
| `npm run check` | TypeScript 类型检查 |
| `npm test` | 启动脚本与前端测试 |
| `npm run test:rust` | 项目内 Rust 测试 |
| `npm run build:web` | 前端调试构建，不是正式发版 |

退出用窗口正常关闭或开发终端 Ctrl+C；不要按 `node.exe`/`pi` 名称批量结束进程。

### 新环境准备

需要 Node 24（开发脚本最低 24.18）、MSVC/Windows SDK 和 WebView2。项目内 Rust 固定 1.99.0，不改系统 PATH：

1. 从[官方固定地址](https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-pc-windows-msvc/rustup-init.exe)下载到 `.tooling/downloads/rustup-init-1.29.1.exe`。
2. 执行 `pwsh -NoProfile -File scripts/setup-rust.ps1`；脚本核对官方 SHA 后安装到本项目 `.tooling/`。
3. 执行 `npm --prefix app ci`，按锁文件安装应用依赖。
4. 执行 `node scripts/prepare-release-runtime.mjs`，下载并核对锁定的应用独立运行资源；已有匹配资源直接核对，不覆盖。

应用 Pi 的源码锁要求 `app/resources/runtime/pi-1.0.4-node-24.21.0/` 内独立 Node 24.21.0 / 上游 Pi 1.0.4，不使用系统开发 Node 或 PATH 中其他 Pi。main的1.0.4资源已准备并核对安装完整性；其他新环境仍须部署匹配资源，版本不匹配明确失败，不能改用旧Pi。新环境是否满足全部桌面能力仍需实际验证。

### 同机Worktree复用开发环境

主工作目录部署一次，分支默认链接下表资源；方向为Worktree同名路径→主工作目录同名路径，Windows可用目录联接。实际主目录见文档真源的当前工作页，不假定Worktree必须位于某个固定父目录。

| 可链接目录 | 前提/用途 |
|---|---|
| `.tooling/rustup` | 固定Rust工具链匹配，不在分支升级或修改共享工具链 |
| `.tooling/cargo/bin` | 已部署Cargo/Rustup工具；不链接完整Cargo Home |
| `.tooling/cargo/registry` | Rust依赖下载缓存，保留Cargo自身锁机制 |
| `.tooling/cargo/git` | 存在时复用Git来源依赖缓存 |
| `app/node_modules` | 依赖声明和package-lock一致，Vite等可写缓存已隔离 |
| `app/resources/runtime` | runtime-lock一致，只读使用本应用Node/Pi安装资源 |

不链接整个 `.tooling`。各Worktree的Vite/WebView缓存、本机启动配置、运行状态、`app/src-tauri/target` 和 `app/dist` 保持独立；正常开发业务库和main自有Pi状态按上述规则共用，明确测试根仍隔离。不对共享node_modules执行npm ci/install，不通过链接更新、清理或删除主环境；版本改变时另准备匹配依赖。创建前保留已有目录，不用删除旧目录来腾出链接位置，不链接其他项目或宿主Pi。共享资源更新由主环境统一协调。

`scripts/dev-environment.mjs` 从Git common目录定位本仓库主环境，按资源组检查独立目录、已共享链接与缺失资源：复用main时比对Rust工具链/Cargo锁、Node依赖声明与锁及runtime锁；已部署的独立目录可使用自己的匹配版本。按白名单准备缺失联接，已有目录保留，错误链接、上级目录联接或共享版本不匹配明确停止，不安装/升级共享资源。Vite缓存与配置加载临时缓存已按Worktree隔离。资源自动准备及正常启动已在保留的集成验证Worktree实际执行，资源边界回归检查已通过；旧分支不能强行共享不同版本的main资源。默认不执行测试、类型检查、构建验证、UI验证或子Agent；环境复用、开发和验证授权分别遵循AGENTS规则。

## 开发环境打包与独立部署

桌面侧栏“工具 → 开发环境”可识别本机Herdr、OpenPI和Skills目录，选择输出后生成 `dev-environment.zip` 与 `skills-manager.zip`。项目、已知认证/会话和缓存不随环境迁移；Skills单独打包，源目录保留。

在新Windows电脑解压环境包，双击包内 `deploy.cmd` 并选择目标目录，无需安装AZCine。已有文件冲突会拒绝覆盖；部署后补充认证，将Skills包解压到自选位置并自行建立链接。Codex不迁移，包内仅提供 `npm install -g @openai/codex` 安装说明，需用户自行执行。代理/MCP服务与自定义路径可能需重新配置。

当前已有同机隔离导出/部署证据，尚未完成真实个人环境、新电脑和桌面UI验收；失败/取消保留未完成产物。正常开发入口仍为根目录 `npm run dev`，本模块不会自动打包或部署。

## UI 组件总览与设计入口

开发入口仍为所在Worktree根的 `npm run dev`，真实桌面与独立UI总览使用同一份组件和生产样式。服务启动后打开根 `index.html`，或使用终端自动输出的 `/ui.html` 地址；无需填写端口。根HTML可离线打开说明页，完整总览需要当前Worktree的开发服务，未提供离线构建快照。

总览使用显式虚构数据与内存控制器，提供页面、详情、编辑、加载/空/错误/长文本等状态和源码清单；不进行真实采集、模型调用、业务保存或资源文件写入。未登记源码/状态提示只辅助查漏，不能证明界面或功能验证通过。历史HTML仍在 `design/index.html`，仅作参考；当前前端以[设计规范](docs/design-spec.md)和生产UI库为准。

后续界面开发从设计规范第1节进入：`app/src/styles/tokens.css` 为主题与尺寸真源，`globals.css` 为唯一生产样式入口，`components/ui/` 为通用组件库，`ui-preview/` 为展示覆盖。不要照旧原型恢复蓝紫主题、旧导航尺寸或另写一套控件。

2026-10-06用户反馈启动缺包后，主环境已按现有package-lock补齐依赖（`npm --prefix app install --ignore-scripts --no-audit --no-fund --package-lock=false`），声明和锁文件未改动，全部直接依赖版本一致，Tailwind所需Windows包已存在。原缺失的七项依赖已补齐；随后根目录 `npm run dev` 已通过Vite加载、正常桌面编译并运行 `azcine.exe`。这是正常启动记录，不是测试、构建验证或UI验收；详细范围见开发计划。

2026-10-08合并dd2785d后的main源码eb3e23b已从根 `npm run dev` 完成隔离真实桌面启动：Vite、Rust开发编译、1440×900窗口与React主界面正常，检查后正常退出0。使用独立虚构配置/数据/WebView根，未打开原业务库；不等于原库或全部功能已验收。仅记录favicon.ico缺失404与退出时WebView类注销提示，详细证据见开发计划第5节。

## 文档入口

| 文件 | 查什么 |
|---|---|
| [AGENTS.md](AGENTS.md) | 工作规则与授权纪律 |
| [requirements.md](docs/requirements.md) | 有效需求、用户决定和验收 |
| [design-spec.md](docs/design-spec.md) | 当前视觉与交互 |
| [development-plan.md](docs/development-plan.md) | 开发顺序、依赖与阶段状态 |
| [project-architecture.md](docs/project-architecture.md) | 中文标注目录树、架构与技术边界 |
| [current-work.md](docs/current-work.md) | 当前任务和暂停点 |

按需读，不全量加载。并行开发时只维护主工作目录的这套文档真源；各Worktree中的副本不单独更新，实际真源位置与文档维护者见主目录[当前工作](docs/current-work.md)。其他旧文档已归档，退出日常读取/更新入口。源码在 `app/`，验证脚本在 `tests/`，每轮证据在 `artifacts/validation/<run-id>/`；不是可以随手清理的用户数据。

当前仅本地开发，无正式发布版本。首次基线提交后可按授权使用功能分支/独立Worktree，不以正式发版为前置；实际提交与远端状态操作前核对。不因文档整理执行Git、推送或发布。
