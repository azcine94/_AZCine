# 当前工作

> 更新：2026-10-06。实现、合入main、技术验证、用户验收与发布分别记录。

- **当前授权已完成**：核对polish全部四个提交，完整合入本地main，统一文档真源与后续前端标准。合并提交 `222358ea8e98ad19b60a5b01f6923be8be1eeb90`；本轮文档另作本地提交，精确版本见Git日志。没有推送/发布/清理、测试/类型检查/构建/UI验证、子Agent、安装依赖、启动桌面、真实采集/模型调用或数据写入授权；未执行这些操作。
- **文档真源与维护者**：`E:/Coding_Work/_AZCine` 的AGENTS.md、README.md、docs/由本主目录指定Codex会话维护。功能Worktree的副本保留，不作最新依据；后续会话先读本页，再定位任务章节和实际代码，不读取其他会话私有聊天或冻结archive。
- **代码来源**：`polish/all-part`，目录 `C:/Users/A/.herdr/worktrees/_AZCine/polish-all-part`，共同基线 `33ace133d6a60a8d3122beb4e037e4fccd0ea626`；源码HEAD `4affaf83b3d542d041ecbd5402105f74756d238f`。四项为d105b27（UI库/设置/处理）、147eb928（AIHOT链/reader/范围与清空）、f4100d3（读取/切筛稳定）、4affaf8（资源/共享Pi）。累计208文件，已全部进入main，未合并其他未交接分支；保留所有分支/Worktree及证据。
- **前端接续入口**：统一标准只在 `docs/design-spec.md` 第1节和模块章节；实际库在 `app/src/components/ui/`，变量在 `tokens.css`，样式统一由 `globals.css` 引入。后续模块必须复用组件/业务变体/亮暗语义变量，页面CSS限定模块布局，同轮补 `ui-preview` 场景/内存状态和摘要；不复制第二套控件、不恢复旧原型主题/尺寸。根index.html连接本Worktree开发服务的UI总览，完整总览不是纯离线HTML快照。
- **最新Pi决定**：2026-10-06用户明确“pi的也公用mian的目录就行。。。这样我好维护”。正常开发源码仍独立，Pi配置/认证/会话/Skills/扩展共用main自有 `.tooling/dev-instance/data/pi/`；main由启动器自动定位。工具→规则与资源为独立全宽双栏入口，官方默认提示词只读，规则/Skill可受限编辑、扩展源码只读/原生启停。`--no-context-files`仍使AGENTS不自动注入；完整请求响应/TUI留待。旧进程需正常结束后从其根npm run dev重启；本轮未启停其他窗口或迁移旧Pi文件。外部Pi/LYWork/OpenPI/宿主不读取、不共享；明确测试根和正式版不用开发共享覆盖。
- **业务数据与实例边界**：业务仍共用原main应用定位的原库；定位配置 `%LOCALAPPDATA%/com.azcine.workbench/data-root.json`，已知原数据根 `C:/Users/A/Documents/AZCineData`，库 `db/azcine.sqlite3`。不读取真实库或认证、不复制/合并/覆盖旧库；缺定位/占用报错，一次一个桌面窗口持有业务写锁。端口/Vite与WebView缓存/运行状态/target/dist独立。当前源码schema8，v6～v8迁移未执行/未验证；共享Pi不代表同一会话多窗口同时写入已验证。
- **启动缺口**：main旧node_modules缺class-variance-authority、clsx、lucide-react、radix-ui、tailwind-merge、@tailwindcss/vite、tailwindcss；依赖声明/锁一致，本轮未安装。后续主环境维护会话按明确范围补齐锁定依赖；不要从旧分支共享链接执行安装。本轮未验证main能够启动。
- **验证与验收**：仅Git提交/范围/关键源码静态核对，无新测试PASS或独立审查通过。原资讯/模型榜/灵感/Agent结果保留原版本范围，不覆盖统一库或新资讯/资源链。147eb928说明称核对24h流程，但本交接没有可核对完整报告，本轮未复现。当前亮暗/三尺寸、SDK实际运行/保存、资源并发锁、schema8、真实模型及正式用户验收留待；之前今天/公司页面用户通过也不自动覆盖polish新样式。
- **交接与证据**：polish摘要 `C:/Users/A/.herdr/worktrees/_AZCine/polish-all-part/artifacts/validation/handoff-20261006-024314/handoff.md`；本轮 `artifacts/validation/integration-polish-20261006-024746/` 保存四提交范围/源码差异、修改前文档和整合结论，不是测试证据。原main未跟踪的会话导出HTML保留，未加入本次提交。
- **暂停点**：本轮到本地合并与文档提交结束。后续等待用户分配具体模块/Agent完善或主环境依赖准备，不自动开发、测试/复核、启动、推送、发版或清理。新统一阅读页尚未挂旧整刊PDF入口（后端仍保留，R-013继续有效），已在计划登记留待；草案导入、原生提问/TUI、通用后台/托盘/自启/桌宠和完整数据保障继续按需求留待。
