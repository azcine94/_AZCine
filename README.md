# AZCine

Windows 个人影视 CG + AI coding 工作台，采用 Tauri 2 / React / TypeScript / Rust / 独立纯上游 Pi。

## 本地运行

在项目根目录执行：

```sh
npm run dev
```

打开真实 Tauri 桌面窗口。开发模式首次自动初始化本目录专用数据根，可保存待办、完成/恢复，管理公司项目文档、文字/list/勾选清单、项目标签、独立交期和指定 list 的交付汇总；大表按 100 行分页。模型榜已接入Agent与文生图Overall各前50的自动获取/保存及Agent输入输出价格。资讯已接18个RSS/Atom信源管理、手动采集、原版Pi整理/分析、固定日报与整期复制/PDF；灵感支持保存编辑、筛选、删除撤销及防重转待办。三分支已合入本地main并完成限定集成验证；资讯模型效果仅用显式回放，正式用户验收未确认。导入核对尚未接入，个人项目内部待定。

独立Worktree也在各自根目录使用同一条 `npm run dev`，打开所在目录的版本，不要求指定模块。正常开发入口已使用所在目录 `.tooling/dev-instance/` 下独立的config/data/webview，并打印配置/数据路径；首次无定位配置时由Rust初始化独立根，已有实例继续使用原配置，失败不重建。Vite缓存在各目录 `.tooling/vite-cache/`。旧开发进程需正常停止后重新运行命令才能获得新环境，不复制或迁移原用户数据；正式版本仍按原数据根选择行为。启动器自动检测可用端口、同步Vite/Tauri devUrl与CSP，并有限重试端口竞争；实际目录、端口及自有PID输出并保存于不入Git的 `.tooling/instance/run-state.json`，启动锁防止同目录重复运行。远程调试默认关闭。已在两个真实Worktree验证独立启动/保存和关闭一方不影响另一方，详细范围见[开发计划](docs/development-plan.md)。

Pi 模型设置和 Agent 页面已挂入口，但 S03 整链路验证与独立复核尚未完成；没有模型不会生成假回复。主窗关闭目前退出。资讯本地自动采集和北京时间日报调度已接，默认关闭、仅电脑及应用实际运行时执行；通用任务队列、托盘和登录自启仍留待。当前实际进度、留待和暂停点分别看[开发计划](docs/development-plan.md)与[当前工作](docs/current-work.md)，不把可运行等同全产品完成。

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

应用 Pi 使用 `app/resources/runtime/` 内独立 Node 24.21.0 / 上游 Pi 0.99.1，不使用系统开发 Node 或 PATH 中其他 Pi。新环境是否满足全部桌面能力仍需实际验证。

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

不链接整个 `.tooling`。各Worktree的Vite/WebView缓存、本机配置、运行状态、`app/src-tauri/target`、`app/dist`、业务数据和应用Pi认证/会话/自定义资源保持独立。不对共享node_modules执行npm ci/install，不通过链接更新、清理或删除主环境；版本改变时另准备匹配依赖。创建前保留已有目录，不用删除旧目录来腾出链接位置，不链接其他项目或宿主Pi。共享资源更新由主环境统一协调。

`scripts/dev-environment.mjs` 从Git common目录定位本仓库主环境，按资源组检查独立目录、已共享链接与缺失资源：复用main时比对Rust工具链/Cargo锁、Node依赖声明与锁及runtime锁；已部署的独立目录可使用自己的匹配版本。按白名单准备缺失联接，已有目录保留，错误链接、上级目录联接或共享版本不匹配明确停止，不安装/升级共享资源。Vite缓存与配置加载临时缓存已按Worktree隔离。资源自动准备及正常启动已在保留的集成验证Worktree实际执行，资源边界回归检查已通过；旧分支不能强行共享不同版本的main资源。默认不执行测试、类型检查、构建验证、UI验证或子Agent；环境复用、开发和验证授权分别遵循AGENTS规则。

## 离线设计入口

双击根 `index.html`，无需服务器。

- `design/workspace-b.html`：已选首页 B。
- `design/project-document.html`：公司文档视觉参考。
- `design/s02-projects.html`、`design/s03-agent.html`：对应阶段的最小状态稿。

设计稿不是生产实现；旧样例的镜头模型不能覆盖最新单镜头行规则。

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
