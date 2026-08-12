# 侧边栏视图栏重构 + 新建笔记小窗 + 顶栏简化

## Goal

解决 6 个 UI/交互问题：侧边栏与内容区色差不足、视图栏无状态反馈且设置页侧边栏为空、右键删除悬停文字被遮盖、对象顶栏操作冗杂易误触、顶栏与视图栏不对齐、新建笔记占满窗口 + 标签联想 bug。

用户价值：侧边栏信息层级清晰可扫读；对象操作收敛到右键（防误触）；元数据按需查看；表单操作在小窗内完成（贴合 800×600 窗口）；标签联想恢复正常。

## Background（已确认事实 + 调查结论）

- 侧边栏 `bg-sidebar` = `#fafafa`（`src/index.css` `--sidebar`），内容区纯白 `#ffffff`——区分度不足（用户反馈）
- 视图栏 `ViewSwitcher.tsx`：4 Tab（含设置），`TabsList` `bg-muted`（#f5f5f5，在 #fafafa 上几乎不可见）；TabsTrigger `text-[0.8rem]`、无 hover 底色（仅 text 颜色变化）
- 设置视图时侧边栏为空：`SidebarList.tsx` settings 分支渲染 Empty 占位（无内容）
- 右键删除项：`ui/context-menu.tsx` destructive = `text-destructive` + `focus:bg-destructive/10`（红字浅红底，悬停可读性差，用户反馈"红色背景遮盖了所有字"）
- 对象详情顶栏 `ContentHeader.tsx` ObjectHeaderActions：元数据圆角块（author/year/url）+ 排序 + 新笔记 + 归档/编辑/删除 icon + （归档对象）恢复按钮
- 内容区顶栏 `h-11 text-sm`，与侧边栏视图栏（p-2 + h-8 TabsList ≈ 46px、顶部 8px padding）不对齐
- NoteForm 为全内容区表单（新建+编辑共用），保存/取消在窗口最底部
- **标签联想 bug 根因（实测复现）**：`TagInput.tsx` 用 `onFocus` 打开 Popover；点击输入框时 focus 触发 `setOpen(true)`，但 radix Popover 的 DismissableLayer 把同一点击序列的后续事件判为外部点击 → **Popover 立即关闭**；实测 `focus()`（无点击）正常打开、`click()` 后立即 false。用户输入第一个字符时 `onChange` 只 setQuery 不重开 Popover → 联想永不显示
- 归档对象顶栏恢复按钮：用户确认改入右键菜单（与活跃对象右键逻辑一致）
- 对象/笔记删除、对象归档/编辑/恢复入口收敛到右键菜单（用户拍板）；笔记卡片悬停 ✎/🗑 保留（用户未提，误触风险低）

## Requirements

- R1 侧边栏底色加深：`--sidebar` 浅色 `#fafafa → #f0f0f0`；暗色模式不动
- R2 视图栏重构：仅 首页/标签/归档 3 Tab，均分侧边栏宽度；侧边栏 `w-48 → w-44`；Tab `h-8 text-[0.9rem]`、hover 底色 + 选中白底高亮；`TabsList` 去 `bg-muted`（改 transparent，避免与侧边栏底色同化）
- R3 设置入口改齿轮图标：侧边栏底部居中圆钮（`aria-label="设置"`），hover 底色、view=settings 时选中高亮；设置视图时侧边栏列表显示"进入设置前的浏览视图"内容（ui store 加 `lastBrowseView`），不再空态
- R4 右键删除项悬停：`bg-destructive` 全红底 + `text-destructive-foreground` 白字
- R5 对象详情顶栏简化：删元数据圆角块；删 归档/编辑/删除 icon 与恢复按钮（均入右键）；新笔记按钮保持**最右侧**；新增圆形 `ℹ` 按钮（Popover 查看 author/year/url，无元数据时隐藏）；排序保留；操作区顺序 [排序] [ℹ] [新笔记]
- R6 内容区顶栏与视图栏对齐：统一 `h-11` 顶部平齐、标题字号 `text-sm → text-[0.9rem]`
- R7 新建/编辑笔记改 Dialog 小窗（新建+编辑共用 NoteForm）；保存/取消在 Dialog 内底部；ObjectForm（对象新建/编辑）保持全内容区
- R8 修复标签联想 bug：TagInput `onChange` 时兜底 `setOpen(true)`（点击误关后输入即重开）

## Acceptance Criteria

- [ ] AC1 侧边栏（#f0f0f0）与内容区（纯白）色差肉眼可辨
- [ ] AC2 视图栏 3 Tab 均分 w-44 侧边栏，字号 0.9rem；悬停有底色、选中白底；无"设置" Tab
- [ ] AC3 设置齿轮在侧边栏底部居中；点击进入设置视图且侧边栏显示原浏览视图列表（非空）；齿轮有选中高亮；Tab 可随时切走
- [ ] AC4 右键「删除」悬停 = 红底白字，文字清晰
- [ ] AC5 对象详情顶栏：无元数据块、无归档/编辑/删除/恢复按钮；[排序] [ℹ] [新笔记]（新笔记最右）；ℹ 点击弹元数据 Popover，无元数据时 ℹ 隐藏；归档对象顶栏仅 [排序] [ℹ] + 已归档 badge
- [ ] AC6 对象行右键：活跃=编辑/归档/删除，归档=恢复/删除，全部可用；归档对象恢复后回首页活跃列表
- [ ] AC7 内容区顶栏与侧边栏视图栏顶部平齐、字号一致（0.9rem）
- [ ] AC8 新建/编辑笔记弹 Dialog 小窗（含标题+标签+保存/取消在窗内底部）；保存后关闭并显示在列表；取消关闭不留表单；对象表单仍全内容区
- [ ] AC9 标签联想：点击输入框后输入字符即弹联想候选（含"创建标签"项与既有标签匹配）
- [ ] AC10 `npm run typecheck` + 全部 smoke + `npm run build` 通过；ui-smoke 更新后全绿

## Out of Scope

- 对象表单（ObjectForm）小窗化（字段多，维持全内容区）
- 笔记卡片悬停 ✎/🗑 入口移除（保留）
- 深色模式视觉微调（token 已随 R1 自动适配，不额外处理）
- 编辑器中正文编辑体验（上一任务已实时保存化）

## Key Decisions（用户拍板）

1. 设置入口：3 Tab + 侧边栏底部齿轮图标；设置视图侧边栏显示原浏览视图（用户确认）
2. 顶栏操作：归档/编辑/删除 + 归档对象的恢复全部收敛到对象行右键（用户确认"和首页逻辑一致"）
3. 笔记表单：新建+编辑都小窗；对象表单不动（用户确认）
4. 侧边栏视觉：底色 #f0f0f0、宽度 w-44、视图字号 0.9rem、顶栏等高对齐（用户同意）
5. ℹ 元数据查看按钮位置：顶栏操作区 [排序] [ℹ] [新笔记]（设计推荐）
6. 标签联想修复方式：onChange 兜底重开 Popover（设计推荐，根因见 Background）
