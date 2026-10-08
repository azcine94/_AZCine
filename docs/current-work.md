# 当前工作

> 更新：2026-10-08。v0.1.0 Windows发布，按授权连续推进。

- **有效授权**：先在main补更新机制、界面并隔离验证，再建release/v0.1.0独立分支/Worktree，走远端PR、CI通过后合并远端main，公开Windows x64 NSIS及更新资产并同步本地main。授权测试/构建、更新签名/GitHub Secret；无子Agent/付费证书/删除用户数据授权。用户不依赖中途回复。
- **文档真源**：E:/Coding_Work/_AZCine，当前主代理维护；后续发版Worktree只改发布源码/工作流，文档仍由此处维护。
- **本地完成**：独立正式版数据根及迁移/切换、可搬运Pi、目录显示布局、固定GitHub稳定更新及关于界面完成；版本统一0.1.0。保留私人未跟踪会话HTML，不读取/提交/删除。
- **验证**：根12+前端152测试、前端类型/构建、Rust release275测试通过；更新UI12项（亮暗三尺寸亲看六图）、独立身份签名包0.0.0→0.0.1真实升级13项、目录迁移/切换/复制后新配置恢复21项通过，安装/恢复三图亲看。版本号统一发生在上述测试之后，最终0.1.0由远端CI重新构建/验证。首次失败证据保留；7项过期Rust测试样本/测试资源定位已修正，未放宽生产规则。
- **证据**：artifacts/validation/release-010-20261008-163212；before保留初始改动。深安装路径导致测试安装器失败，短隔离目录重跑升级通过；不建议深自定义安装路径。全部使用虚构库/假认证，无付费模型/云端OneDrive/第二台实体电脑/独立复核，不宣称全产品用户验收。
- **远端**：azcine94/_AZCine公开仓库，账号ADMIN、Actions启用，远端main4c747a9，本地原基线4a0f07c领先38落后0。git单命令代理127.0.0.1:7890可连接，未改全局设置。待推release分支并以merge commit合并PR，不直接推main。
- **签名**：本机私钥.tooling/release-signing/azcine-updater.key（ACL仅当前用户/SYSTEM），GitHub Secret TAURI_SIGNING_PRIVATE_KEY已配置；公钥在tauri.conf。不得打印私钥或generate.log；用户需自行妥善备份，后续更新沿用同一密钥。无Windows发布者证书。
- **下一步**：提交main，建立release/v0.1.0独立Worktree；Windows工作流/发布资产生成器草稿在本run/release-drafts，须接入并验证。完成PR/CI/合并后运行发布工作流、下载公开包验证，最后同步本地main。尚未推送/PR/正式Release，不提前记发布。
