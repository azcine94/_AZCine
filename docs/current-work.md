# 当前工作

> 更新：2026-10-07。实现、合入main、技术验证、用户验收与发布分别记录。

- **当前任务已完成**：用户要求“合并一下这个分支吧agent-dev的”。本轮将 `feat/agent-dev@62c93dce4f3da4c47921c4242d54396495ae6785` 的三个提交从 `main@3e4ff36255390bffaba27be121b69616dbbad187` 快进合入本地main，无冲突；120文件、4752新增/510删除。MCP/草案核对、限定后台、会话/附件/生命周期、今日资讯与嵌套工具归组进入main；此前polish/记账/资源权限修复保留。受影响真源局部同步并提交，文档提交标识见Git日志。
- **文档真源与维护者**：`E:/Coding_Work/_AZCine` 的AGENTS.md、README.md、docs/由本主目录指定Codex会话维护。功能Worktree副本保留，不作最新依据；先读本页，再定位任务章节与实际代码，不读取冻结archive或私有聊天。
- **来源与其他Worktree**：本次仅合 `feat/agent-dev`，目录 `C:/Users/A/.herdr/worktrees/_AZCine/feat-agent-dev`，源HEAD与共同基线如上；de64572/45cf263/62c93dc分别为MCP/界面与runtime锁、生命周期/今日资讯、嵌套工具归组。源工作区干净，分支/目录/证据保留。其他Worktree未同步或改动；主目录原未跟踪会话HTML保留且不入提交。
- **Pi资源准备缺口**：源码锁从0.99.1升为官方Pi1.0.4，Node24.21.0不变；main本机 `app/resources/runtime/` 目前仅0.99.1，Git不带被忽略的runtime。本轮未安装/复制/链接新版资源，不启动应用；正常main启动前须按后续环境操作授权准备匹配1.0.4。源Worktree独立1.0.4与旧main资源均保留。安装工具生成候选/proposed lock，不自动部署。旧Pi进程不能当新版MCP验收。
- **应用资源边界**：Pi核心和默认系统提示不patch。交接明确授权一份auto-session-title扩展及应用azcine MCP条目，其他用户资源不覆盖；标题扩展一次安装尊重用户修改/移除，旧固定hash应用规则保副本退出加载。`--no-context-files`仍限制AGENTS注入，基础select/confirm/input/editor响应已接但完整TUI交接留待。外部Pi/LYWork/OpenPI/宿主不读取或共享。
- **业务与任务边界**：MCP可检索/读取projects/today/ideas/bookkeeping/news/models，正式变更先草案再本人核对、整批版本/事务与applied回执；项目表格不嵌图片，待办无任意字段更新、模型榜只读、资讯限已有公开源/流程。后台仅summarize-text/summarize-batch/draft-objects及日志/输出/取消，非任意任务或原版自主spawn，托盘/自启/关机调度留待。
- **共享数据与版本**：正常开发仍定位原main库，源码schema16：v13 Agent记录、v14任务上下文/ordinal、v15会话软删除/原生路径屏蔽、v16待办软删除。未打开或迁移真实库；升级后schema12及更早程序拒绝该库，其他Worktree启动前需按各自授权同步兼容代码。缺定位/占用明确报错，一次一个桌面窗口持业务写锁，不回退空库。已知原数据根 `C:/Users/A/Documents/AZCineData`，定位 `%LOCALAPPDATA%/com.azcine.workbench/data-root.json`；本轮未读取其内容。
- **实例与生命周期**：正常Pi状态仍由common-dir定位main自有 `.tooling/dev-instance/data/pi/`，测试/正式版自身根；端口/WebView/cache/target/dist独立。切模块保当前会话/输入，历史只读首次发送再连接，generation/epoch/seq保护异步归属，空闲600秒释放，投影目标8个/约128MiB且保护活动内容。共享Pi多进程同会话写安全未验证；旧目录/认证不复制合并或迁移。未启停其他窗口/Pi。
- **前端接续**：统一标准仍只在设计规范第1节及模块章节，复用tokens/globals/components/ui；本轮补固定footer草案核对、附件/右键/状态与Agent零件的实际规范。今天资讯最多10条并组件内滚动；嵌套工具按原生父ID去重归组且真实异常保留。UI总览场景已随源提交进入main，未运行总览。
- **验证与验收**：本轮只核对Git祖先/范围、公共入口/迁移/资源锁与交接源码事实，未运行测试、类型检查、构建、启动、UI验证、模型请求或子Agent，无新PASS/独立复核通过。旧安装/启动与功能结果保留原版本范围；真实草案/冲突/取消、标题/附件/右键、冷历史并发/空闲缓存、后台容量与schema12→16迁移、亮暗三尺寸/正式验收均留待。
- **交接与证据**：源摘要 `C:/Users/A/.herdr/worktrees/_AZCine/feat-agent-dev/artifacts/validation/handoff-20261007-215405-1071/handoff.md`；本轮 `artifacts/validation/integration-agent-dev-20261007-220214/` 保存来源副本、120文件范围、合前状态与修改前真源文档。都是合并证据，不是测试报告。
- **暂停点**：止于本地合并与文档同步；未推送、发版、清理、部署main runtime或升级原库。下一轮等待用户明确任务，不自动测试/开发/委派或同步其他分支。完整TUI/通用资料导入、整刊PDF入口、完整父子后台/托盘/桌宠与数据备份迁移按原需求留待。
