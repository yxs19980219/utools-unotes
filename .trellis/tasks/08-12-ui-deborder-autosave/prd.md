# UI 去分割线改造 + 笔记实时保存链路简化

## Goal

让插件 UI 摆脱"分割线分割区域"的视觉风格，改用色阶（浅灰侧边栏 vs 纯白内容区）区分区域；同时砍掉"打开笔记 → 写正文 → 手动保存"的两段式链路，改为点开即写、防抖实时落盘，删除整套未保存确认机制。

用户价值：界面更干净现代；写笔记路径从 3 步缩为 1 步，不再有"忘保存丢内容"的心智负担。

## Background（已确认事实，file:line 锚点）

- 两栏布局骨架在 `src/App.tsx:60`：`aside` 用 `border-r border-border` 分割，内容区 `bg-background` 纯白
- 颜色 token 已存在：`--sidebar: #fafafa`（浅灰）、`--muted: #f5f5f5`、`--background: #ffffff`（`src/index.css`），`bg-sidebar` 可用但未被使用
- 顶栏分割线分布：`ContentHeader.tsx:159,306,323`（对象详情顶栏 + 编辑态 + 通用顶栏 `border-b`）；`NoteView.tsx:189`（笔记详情工具行 `border-b`）、`:219`（编辑态底部栏 `border-t`）
- 对象元数据现状：`ContentHeader.tsx:234-261` 单独第二行 `border-b border-border`（author/year/url）
- 笔记打开链路：`NoteView.tsx:77` 非空正文默认只读 → 点「写正文」（`:263-267`）→ 编辑 → 手动「保存正文」（`:231-234`）/Ctrl+S
- 草稿保护机制（待删）：`NoteView.tsx:36-61` localStorage 草稿 + `DirtyGuard.tsx` 全组件 + `stores/ui.ts:48-129`（pendingDirty/dirtyRoute/requestRoute/cancelRoute/discardDirty）
- requestRoute 调用点：`ContentHeader.tsx:105,197,215`、`NoteCardList.tsx:64,86,88,103`、`NoteView.tsx:71,190`、`SidebarList.tsx:126,183,249,268,287,306,319,334,364,376,409`、`ViewSwitcher.tsx:20,26`
- NoteForm 的 dirty 保护：`NoteForm.tsx:82-96,136`（ObjectForm 无 dirty 保护，`ObjectForm.tsx` 全文件无 setPendingDirty）
- 表单底部操作栏 `border-t`：`NoteForm.tsx:250`、`ObjectForm.tsx:148`
- 笔记卡片带边框（保留）：`NoteCardList.tsx:90`
- db 层：`db.ts:235-238` `updateNote` 缺 `_rev` 时读库补齐；带旧 `_rev` 的 put 会 conflict（`db.ts:77-79` 内存实现模拟）
- 侧边栏/行组件内部无分割线（SidebarRow 只用 bg-muted/bg-accent）

## Requirements

### A. 去分割线（视觉）

- R1 侧边栏与内容区分割：`aside` 去掉 `border-r`，改用 `bg-sidebar`（浅灰）；内容区保持 `bg-background`（纯白）
- R2 所有顶栏去掉 `border-b`（通用顶栏、编辑态顶栏、对象详情顶栏、笔记详情工具行），靠色阶/留白分区
- R3 对象来源元数据改为方案 B：author/year/url 收进标题行下方的浅灰圆角信息块（`bg-muted/50 rounded-md`），与书籍 Badge + 标题一体；去 `border-b`
- R4 笔记卡片保留现有边框方案（不改动 `NoteCardList.tsx:90`）
- R5 表单（NoteForm/ObjectForm）底部操作栏去 `border-t`，改用浅灰背景（`bg-muted/50`）色阶区分

### B. 实时保存链路

- R6 打开非归档笔记直接进入编辑态（CodeMirror + MarkdownToolbar），删除「写正文」按钮
- R7 正文实时保存：停止输入 300ms 防抖自动落盘（`updateNote`）；保存成功静默（不弹 toast）；失败 `toast.error` 提示
- R8 删除编辑态底部操作栏（保存正文/取消按钮/Ctrl+S 提示文案）
- R9 删除 DirtyGuard 机制：`ui.ts` 的 pendingDirty/dirtyRoute/dirtyOnDiscard/setPendingDirty/requestRoute/cancelRoute/discardDirty 全删；`DirtyGuard.tsx` 文件删除；所有 requestRoute 调用点改为直接调用（openNote/selectObject/selectTag/setView/startEditing/closeNote）
- R10 删除 NoteView 的 localStorage 草稿机制（draft 读写/防抖落盘/恢复 toast）
- R11 删除 NoteForm 的 dirty 保护（dirty 计算与两个 effect），表单保留手动保存按钮（新建无 id，无法实时保存；保存机制不变）
- R12 只读态仅保留给归档笔记（`object.archived`），仍走 MarkdownView

### C. 编辑态元信息（新增决策）

- R13 编辑态顶部保留一行元信息（标签 chips + 更新时间小字，浅灰小字、无分割线、留白分隔），避免编辑时看不到标签/时间

## Acceptance Criteria

- [ ] AC1 界面无结构性分割线：侧边栏无 `border-r` 且为浅灰（`bg-sidebar`）；内容区纯白；任意顶栏下方无 `border-b`
- [ ] AC2 对象详情页 author/year/url 显示在圆角浅灰信息块内，无分割线
- [ ] AC3 打开非归档笔记即进入编辑态（编辑器聚焦、工具栏可见），全页面无「写正文」「保存正文」按钮、无底部保存操作栏
- [ ] AC4 连续输入停止后 300ms 内正文自动落盘：重开插件（重新 bootstrap）后内容完整保留；保存过程无成功 toast、无确认弹窗
- [ ] AC5 编辑态切换对象/标签/视图不弹任何未保存确认框，切换正常
- [ ] AC6 归档笔记仍为只读渲染（MarkdownView），无编辑入口
- [ ] AC7 笔记卡片保留边框；悬停编辑/删除操作可用
- [ ] AC8 对象/笔记表单：手动保存按钮保留（新建/编辑流程不变），底部操作栏无 `border-t` 线（浅灰背景）
- [ ] AC9 保存失败场景（db 抛错）出现 toast.error 提示（可手动断点/模拟验证）
- [ ] AC10 `npm run typecheck`、`npm run smoke`、`npm run smoke:stores`、`npm run ui-smoke`、`npm run build` 全部通过

## Out of Scope

- 深色模式：dark token 已定义，色阶随 token 自动适配，不额外处理
- 移动端/响应式布局
- 编辑器功能本身（Markdown 语法、工具栏项、CodeMirror 配置）
- 搜索/排序/来源筛选逻辑
- db 层存储契约与数据结构
- Ctrl+S 快捷键：保留 onSave（编辑器内 Ctrl+S 立即 flush 保存），不新增 UI 提示

## Key Decisions（用户拍板）

1. 侧边栏浅灰 / 内容区纯白，去分割线（用户）
2. 元数据用方案 B 圆角信息块（用户）
3. 笔记卡片保留边框（用户）
4. 实时保存防抖 300ms（用户：防抖调低）
5. DirtyGuard 无兜底彻底删除，含表单 dirty 保护一并删除（用户）
6. 保存成功静默、失败 toast（设计推荐，见 design.md 权衡）
7. 编辑态顶部保留标签+时间小字行（设计推荐）
