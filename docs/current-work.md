# 当前工作

> 更新：2026-10-07。实现、合入main、技术验证、本人验收与发布分别记录。

- **当前任务已完成**：用户按截图要求“这个分支也合并到本地main吧”。已将 `feat/kanban-dev@83342ace0440a0b31b2ec5c15442b67025b0b797` 合入本地main；合前main `8b3b5648455c54ed42de3bd26cdc796bbd19f6ed`，共同基线3e4ff36，双方分叉4/1提交。源53文件6134新增/23删除，8处公共文件冲突逐项解决，保Agent/任务面板双方接入。main原五份Pi1.0.4未提交文档全部保留并纳入本轮同步提交；合并提交标识见Git日志。
- **文档真源与维护者**：`E:/Coding_Work/_AZCine` 的AGENTS.md、README.md、docs/仍由主目录指定Codex会话维护；功能Worktree副本保留不作最新依据。先读本页，再定位需求/设计/计划/架构与实际代码，不自动读冻结archive或私有聊天。
- **来源与保留**：源Worktree `C:/Users/A/.herdr/worktrees/_AZCine/feat-kanban-dev`，源提交83342ac含全部累计实现；源未提交 `.vibe/git-commit-log.md` 留在原目录，不并入main。分支/Worktree/原报告全部保留，主目录原未跟踪会话HTML不入提交。其他分支未同步或改动。
- **任务面板边界**：总仓库统一任务/项目/共享架构与记忆，分支只为执行位置；权威库在所选总仓库 `.azcine/task-panel/state.sqlite3`，交接/上下文/回执在tasks/<id>/runs，执行Worktree在 `.azcine/worktrees/`。自动建Herdr窗格、PowerShell codex/opi、精确绑定/派发、状态/Git观察、取消恢复、分层图与确认记忆已接；不把idle/Agent候选或图导入当本人验收，词法索引不当完整Tree-sitter。缺外部工具明确报错，本轮不安装或修改其宿主。
- **集成解决**：build.rs/capabilities/lib/App及UI catalog/controllers/foundation冲突保双方路由/命令/权限、Agent侧栏/今日资讯/业务草案、task-panel壳与总览/监控/退出。storage与分支识别按结构协调，业务全局schema16、task_panel_schema14；旧任务13/14不跳过Agent初始化，Agent16不重跑旧迁移，待办软删除与MCP事务保留；旧fixture/版本断言已同步但未运行。
- **Pi资源已替换**：上一轮用户明确在main升1.0.4且不要旧版，现main自有 `app/resources/runtime/pi-1.0.4-node-24.21.0/` 与锁匹配，旧0.99.1运行目录已删除。官方归档1248文件及16993复制文件哈希对齐，仅安装完整性；配置/认证/会话未改，Pi核心/默认提示未patch。正常开发Pi状态仍由common-dir定位main自有根，测试/正式版自身根。已有进程不会自动升级，需正常退出后根npm run dev重启；本轮未启停它。
- **Agent与数据边界保留**：先草案本人核对再整批业务事务，applied才代表保存；授权auto-title/azcine MCP及基础扩展响应保留，完整TUI/通用资料导入与任意后台/托盘留待。业务仍定位原main库，一次仅一桌面窗口持写锁，缺定位/占用明确报错，不回退空库。本轮未读取原库/认证，未迁移、合并或覆盖用户数据；独立仓库任务库application_id/版本不混用业务schema。正常开发共享Pi同会话多写未验证。
- **前端接续**：沿用设计规范第1节和本模块章节、当前tokens/globals/components/ui；任务面板与Agent所有总览素材均为虚构内存场景，未启动总览或重选方向。最新需求含R-020任务面板，其他模块历史用户验收只覆盖原版本。
- **验证与验收**：本轮只核对Git范围、冲突代码/权限/迁移与文档事实；未运行测试、类型检查、构建、启动、UI验证、模型任务或子Agent，无新功能PASS或独立复核。源旧联调只对应其source-hashes，OpenPI真实任务、当前看板/派发/恢复、schema迁移、公共模块回归/亮暗三尺寸和正式本人验收留待。早先 `_Skill_Manager` 联调/保留窗口为原会话操作，本轮不延用也不控制那些记录/窗格。
- **证据**：源交接 `C:/Users/A/.herdr/worktrees/_AZCine/feat-kanban-dev/artifacts/validation/handoff-20261007-222559/handoff.md`；本轮 `artifacts/validation/integration-kanban-dev-20261007-223829/` 保存来源副本、合前状态/文档、53文件范围及Pi文档原补丁。Pi替换证据在 `artifacts/validation/replace-main-pi-104-20261007-222508/`。均非测试报告。
- **暂停点**：止于本地合并与文档提交；未推送、发版、清理分支/Worktree、打开原库或执行任务归并/模型/Herdr动作。下一轮等明确任务，不自动开发、验证或委派；完整TUI/通用导入、整刊PDF入口、任意父子后台/托盘/桌宠与完整备份迁移按原需求留待。
