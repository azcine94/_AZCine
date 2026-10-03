# Open-source personal workspace references

2026-10-01。状态：下列第一轮候选已被用户明确否决，不再推荐其任务清单路线。最新图片对照见 `round-2/index.html`；继续讨论通用个人项目空间，未修改项目模块。

打开 `index.html`，三种操作方式分别为：项目清单（Vikunja）、今日执行（Super Productivity）、状态看板（Kanboard）。主代理已实际打开所有展示图片，非仅根据URL或OCR推断。

## Verified public sources

### Vikunja
- Repo: https://github.com/go-vikunja/vikunja
- API: https://api.github.com/repos/go-vikunja/vikunja （200，AGPL-3.0，not archived）
- Source page: https://vikunja.io/
- `vikunja-task-list.png`: https://vikunja.io/_astro/02-task-list.CTo2oooO.png （200，PNG，2800×1700）
- `vikunja-task-detail.png`: https://vikunja.io/_astro/06-task-detail.CGGgY66j.png （200，PNG，2800×1700）

### Super Productivity
- Repo: https://github.com/super-productivity/super-productivity
- API: https://api.github.com/repos/super-productivity/super-productivity （200，MIT，not archived）
- Source page: https://super-productivity.com/
- `super-productivity-eisenhower.png`: https://super-productivity.com/images/screenshots/desktop/eisenhower-light.png （200，PNG，2560×1600）。这是四象限工作界面，不是项目列表。
- `super-productivity-task-detail.png`: https://raw.githubusercontent.com/super-productivity/super-productivity/master/docs/wiki/assets/1.01-First-Steps-task-details-1.png （200，PNG，727×685）。来源：https://github.com/super-productivity/super-productivity/wiki/1.01-First-Steps 。是带教学标记的局部图，按原尺寸展示。

### Kanboard
- Repo: https://github.com/kanboard/kanboard
- API: https://api.github.com/repos/kanboard/kanboard （200，MIT，not archived）
- README: https://raw.githubusercontent.com/kanboard/kanboard/main/README.md （200，明确 maintenance mode，不再主动开发大型新功能）
- `kanboard-board.png`: https://kanboard.org/assets/img/board.png （200，官方首页引用）。较旧界面，作为结构备选，不是推荐换技术栈。

## Excluded / supplementary

- AppFlowy repo/API: https://github.com/AppFlowy-IO/AppFlowy ，https://api.github.com/repos/AppFlowy-IO/AppFlowy （200，AGPL-3.0）。官网图片 `appflowy-project-tracking.webp` 来自 https://appflowy.com/_next/static/media/project-tracking.94a5c1eb.webp （200）；目视为含多人光标的营销组合图，仅补充，不当个人项目完整界面。README两个旧截图URL tasks.796c753e.png 与 Grid.9e30484b.png 实际404，未伪造产物。
- Focalboard: https://raw.githubusercontent.com/mattermost-community/focalboard/main/README.md （200）明确 currently not maintained，本次不优先推荐。

## Boundaries

- 不登录、不安装、不运行这些项目，不拿品牌图用于AZCine正式UI。
- 图中Teams、成员、指派、分享、协作审阅、评论等不进入产品。独立BCOPY / BCOPY+ / FINAL节点仍保留，不因看板或单一任务截止日简化掉。
- 未使用星标数、价格或版本号评优。许可仅用于确认公开项目性质；若将来复用代码需另行评估，不因参考截图就默认采用实现。
- 英文目录迁移方案在 `../structure-proposal.md`，尚未迁移旧文件。此目录所有新增文件均英文命名。
