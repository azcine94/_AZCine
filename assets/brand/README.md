# AZCine brand lockup

用户要求以指定图片替换左导航整组“AZ 方块 + AZCine 字标”，不是只替换方块。

- `logo-original.png`：用户原图逐字节复制，1774×887，透明RGBA，黑色完整手写字标。原始输入保留未改。
- `logo-lockup.png`：只裁透明留白，提取框 left=134、top=237、width=1523、height=464，包住所有alpha>0像素并留16px边。无拉伸、无重绘。
- 浅色主题直接显示黑字；深色用CSS `brightness(0) invert(1)`显示同形白字，不增加第二遍产品文字。
- 导航正常宽度等比显示最大144px；窄导航保留整幅缩小，绝不裁成AZ图标。
- `logo-on-white.png`、`logo-lockup-preview.png`、`sidebar-light.png`、`sidebar-dark.png` 是观察透明底及使用效果的本地预览，不是新的品牌设计。

当前原型位于design/，引用 `../assets/brand/logo-lockup.png`；英文目录迁移已完成。全部新增文件英文命名。
