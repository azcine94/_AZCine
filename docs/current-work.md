# 当前工作

> 更新：2026-10-08。Windows v0.1.0发版任务已完成。

- **发布**：[v0.1.0](https://github.com/azcine94/_AZCine/releases/tag/v0.1.0)，仅Windows x64 NSIS，源码标签f145dcf909806fd00ad4b48e0f015a7a4870d511。安装包、更新签名、latest.json和SHA256SUMS均已公开；不含个人数据/认证/签名私钥。
- **交付**：release/v0.1.0，Worktree为C:/Users/A/.herdr/worktrees/_AZCine/release-v0-1-0；[PR #1](https://github.com/azcine94/_AZCine/pull/1)已合并，功能代码已同步本地main。收尾只回填七个核心入口内的相关文档，未新增产品功能；分支/Worktree及私人未跟踪会话HTML保留。文档真源E:/Coding_Work/_AZCine由当前主代理维护。
- **CI**：首轮37756039210因干净构建机缺Cargo registry缓存失败，cdf94b5补测试前cargo fetch；[CI37757033569](https://github.com/azcine94/_AZCine/actions/runs/37757033569)与[发布37759174440](https://github.com/azcine94/_AZCine/actions/runs/37759174440)全部成功，脚本12/前端152/Rust275项及正式Windows构建通过。
- **实测**：更新UI12项（亮暗三尺寸六图）、独立身份已签名0.0.0→0.0.1升级13项、目录迁移/切换/复制后新配置恢复及Pi会话重开21项通过。公开包另安装验证6项通过：版本0.1.0、首次空根/空记录、虚构待办保存、上游Pi连接、实际GitHub更新提示当前最新。安装及恢复截图均已亲看。
- **正式版本机状态**：已安装到%LOCALAPPDATA%/AZCine；测试数据全在artifacts/validation。测试新建的正式定位文件/锁已移入证据，保留原有WebView；下次正式启动仍需本人选择专用数据根，建议文档/AZCineData-Release。没有复制或改动开发业务根C:/Users/A/Documents/AZCineData及main自有开发Pi状态。
- **证据**：artifacts/validation/release-010-20261008-163212，含初始备份、失败与修正记录、远端日志、公开下载/校验和安装截图。公开安装包SHA256：d7cf7768fcd9a02de9d109109e953fa396388af779619e3b33b61f82d469dd23。测试目录保留，不自行删除。
- **签名**：私钥只在.tooling/release-signing/azcine-updater.key（ACL限当前用户/SYSTEM）和GitHub Secret TAURI_SIGNING_PRIVATE_KEY；不得打印私钥/generate.log。后续版本沿用同一密钥，维护者需妥善离线备份。未购买Windows发布者证书，可能显示未知发布者。
- **边界与留待**：真实OneDrive云端/第二台实体电脑/付费模型效果/全模块桌面验收及独立复核未执行；深自定义安装路径可能触发NSIS限制，推荐默认位置。安装器失败不等于程序文件原子回滚，数据根独立保留。后续版本经PR、检查、main手动Windows release流程发布；自动备份、通用导入、完整PDF、托盘/自启等未完项仍按需求/计划，不因本次发布自动续建。
- **后续授权**：本轮没有子Agent、付费服务或删除用户数据授权。任务收尾后，新功能、额外验证、清理分支/Worktree/证据均按用户新指令执行。
