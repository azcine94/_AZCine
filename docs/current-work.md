# 当前工作

> 更新：2026-10-10。Plainva笔记模块暂停在清理与交接；用户自行新建分支接续。

## 当前任务与暂停点

- **2026-10-29 herdr风前端（R-025）**：Worktree `C:/Users/A/.herdr/worktrees/_AZCine/polish-0-1-3-polish`，分支 `polish/0.1.3-polish`，基线main `c8dae4c`。已按用户选定演示v8改全局主题、共用组件、外壳、今天页、设置页7主色及各模块局部圆角/颜色；本地打包三款OFL字体。用户要求提交并发版v0.1.4：经PR合入main，云端Windows release去掉Artifact存储步骤后直传Release；本机tsc与npm test 160项通过，未独立复核。演示与旧tokens/month-grid备份在该Worktree被忽略的 `artifacts/validation/design-explore-20261029/`。
- **方向**：R-024选定Plainva源码移植，在AZCine内部编辑和操作现有Obsidian笔记；具体有效决定见requirements.md“笔记接入”。没有完成demo、编辑器移植或真实库读写接入。
- **交接**：[Plainva模块交接](../artifacts/validation/plainva-handoff-20261010-135103/handoff.md)。该本机文件被Git忽略，新Worktree不会自动带上，接续会话应从主目录绝对路径读取。
- **目录与基线**：文档真源为E:/Coding_Work/_AZCine，由本主目录会话维护；当前main为44b02cae42b5155aa57444e7bf99d10b0b47aba3（提交标题Release 0.1.1）。笔记功能分支及Worktree尚未创建，后续会话重新核对实际基线；未查询线上发布状态。
- **清理未完成**：用户已明确授权删除本次下载物，安装进程已停止；.tooling/previews/plainva-20261010仍存在。递归删除再次被自动审批拒绝，工具仅返回blocked by policy；未绕过。仅此目录属于本次清理范围，原Obsidian库、主环境及无关会话HTML保留。
- **本轮边界**：只清理下载物并写交接；不继续安装、开发、测试或调用子Agent，不创建/提交/推送分支。此前没有修改真实笔记；本次只核对文件与Git状态，不代表功能验证。

## 既有发布记录（2026-10-08，非当前版本验证）

以下保留原v0.1.0交付记录；当前main已有后续提交，不能将这些旧结果作为笔记模块或当前main的验证结论。

- **发布**：[v0.1.0](https://github.com/azcine94/_AZCine/releases/tag/v0.1.0)，仅Windows x64 NSIS，源码标签f145dcf909806fd00ad4b48e0f015a7a4870d511。安装包、更新签名、latest.json和SHA256SUMS均已公开；不含个人数据/认证/签名私钥。
- **交付**：release/v0.1.0，Worktree为C:/Users/A/.herdr/worktrees/_AZCine/release-v0-1-0；[PR #1](https://github.com/azcine94/_AZCine/pull/1)已合并，功能代码已同步本地main。收尾只回填七个核心入口内的相关文档，未新增产品功能；分支/Worktree及私人未跟踪会话HTML保留。文档真源E:/Coding_Work/_AZCine由当前主代理维护。
- **CI**：首轮37756039210因干净构建机缺Cargo registry缓存失败，cdf94b5补测试前cargo fetch；[CI37757033569](https://github.com/azcine94/_AZCine/actions/runs/37757033569)与[发布37759174440](https://github.com/azcine94/_AZCine/actions/runs/37759174440)全部成功，脚本12/前端152/Rust275项及正式Windows构建通过。
- **实测**：更新UI12项（亮暗三尺寸六图）、独立身份已签名0.0.0→0.0.1升级13项、目录迁移/切换/复制后新配置恢复及Pi会话重开21项通过。公开包另安装验证6项通过：版本0.1.0、首次空根/空记录、虚构待办保存、上游Pi连接、实际GitHub更新提示当前最新。安装及恢复截图均已亲看。
- **正式版本机状态**：已安装到%LOCALAPPDATA%/AZCine；测试数据全在artifacts/validation。测试新建的正式定位文件/锁已移入证据，保留原有WebView；下次正式启动仍需本人选择专用数据根，建议文档/AZCineData-Release。没有复制或改动开发业务根C:/Users/A/Documents/AZCineData及main自有开发Pi状态。
- **证据**：artifacts/validation/release-010-20261008-163212，含初始备份、失败与修正记录、远端日志、公开下载/校验和安装截图。公开安装包SHA256：d7cf7768fcd9a02de9d109109e953fa396388af779619e3b33b61f82d469dd23。测试目录保留，不自行删除。
- **签名**：私钥只在.tooling/release-signing/azcine-updater.key（ACL限当前用户/SYSTEM）和GitHub Secret TAURI_SIGNING_PRIVATE_KEY；不得打印私钥/generate.log。后续版本沿用同一密钥，维护者需妥善离线备份。未购买Windows发布者证书，可能显示未知发布者。
- **边界与留待**：真实OneDrive云端/第二台实体电脑/付费模型效果/全模块桌面验收及独立复核未执行；深自定义安装路径可能触发NSIS限制，推荐默认位置。安装器失败不等于程序文件原子回滚，数据根独立保留。后续版本经PR、检查、main手动Windows release流程发布；自动备份、通用导入、完整PDF、托盘/自启等未完项仍按需求/计划，不因本次发布自动续建。
- **该次发布的授权边界**：没有子Agent、付费服务或删除用户数据授权；后续以当前任务与用户最新指令为准，旧发布授权不自动延续。
