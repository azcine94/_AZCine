# AZCine

Windows 个人影视 CG + AI coding 工作台，采用 Tauri 2 / React / TypeScript / Rust / 独立纯上游 Pi。

## 本地运行

在项目根目录执行：

```sh
npm run dev
```

打开真实 Tauri 桌面窗口。首次选择专用数据根后，可保存待办、完成/恢复，管理公司项目文档、文字/list/勾选清单、项目标签、独立交期和指定 list 的交付汇总；大表按 100 行分页。数据可退出重开回查，导入核对尚未接入，个人项目内部待定。

独立Worktree也在各自根目录使用同一条 `npm run dev`，打开所在目录的版本，不要求指定模块。**自动分配端口与隔离运行目录尚未实现：** 当前默认端口仍固定1420，正常入口尚未自动隔离配置和数据，不能直接同时启动多个副本。已确认的启动器改造与状态见[开发计划](docs/development-plan.md)；实现后由脚本自动检测/分配端口、隔离实例并输出运行信息，用户无需手动检查或维护端口表。

Pi 模型设置和 Agent 页面已挂入口，但 S03 整链路验证与独立复核尚未完成；没有模型不会生成假回复。主窗关闭目前退出，托盘/定时在后续阶段实现。当前实际进度、留待和暂停点分别看[开发计划](docs/development-plan.md)与[当前工作](docs/current-work.md)，不把可运行等同全产品完成。

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

**当前仅已确认这套复用规则，尚未创建链接或实现自动准备。** 开发启动器D-001还需在同一 `npm run dev` 入口支持资源定位/版本匹配/链接准备及可写缓存隔离；不能把当前缺依赖的报错当作已能自动复用。默认不执行测试、类型检查、构建验证、UI验证或子Agent；环境复用、开发和验证授权分别遵循AGENTS规则。

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
