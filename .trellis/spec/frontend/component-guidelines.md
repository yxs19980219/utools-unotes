# Component Guidelines

> How components are built in this project.

---

## Overview

本项目组件模式 = **纯展示组件 + store 接线分离**：

- 组件不直接 import `services/`（唯一受控例外见 directory-structure.md）；数据全部经四个 Zustand store（ui/objects/notes/tags）读取，写操作调用 store action
- 通用展示组件（NoteCardList / TagChip / SidebarRow）通过 props 接收数据或 id，内部自己订阅 store 取投影（如 `NoteCardList.tsx:202-206` 订阅 objects/tags 构建 `objectById`/`tagById` Map）
- 800×600 紧凑密度：列表行高 `h-7`/`h-8`、卡片 `p-2.5`、小字 `text-xs`/`text-[0.7rem]`、header `h-11`、侧边栏 `w-48`（`src/App.tsx:57`）
- 全产品只有两种内容形态（R6）：卡片列表 + 笔记全文；NoteCardList 是三语境复用的唯一列表组件

---

## Component Structure

文件结构约定（见各组件头部 JSDoc）：

1. 文件头 JSDoc：职责 + 对应 design.md 章节 + 关键交互契约
2. imports 顺序：React → lucide-react/sonner → 组件（@/components）→ lib → services（仅受控例外）→ stores → types
3. 组件内部自上而下：store 订阅 → 本地 state → useMemo 派生 → 回调 → JSX
4. 模块级辅助函数放在组件定义之前（如 `NoteCardList.tsx:42` `excerptOf`、`ContentArea.tsx:31` `TagNotesList` 等私有组件）

**受控组件模式**：表单类组件（ObjectForm/NoteForm/TagInput）用本地 useState 持有草稿，保存时才经 store action 提交（`NoteForm.tsx`：`objectId/title/content/tags` 全为 useState 初值，提交时才 `resolveTagIds` + `create/update`）。这是"编辑态"语义：store 只记录 `editing: {kind, id}`，草稿不进全局状态。

---

## Props Conventions

- props 用内联 interface 定义在文件内（就近原则），具名导出复杂类型（如 `NoteCardList.tsx:190` 的 props：`notes` / `crossObject` / `presorted`）
- 语境差异用布尔 prop 区分而非复制组件：`NoteCardList` 的 `crossObject`（标签/搜索语境显示对象名+来源角标）与 `presorted`（搜索结果跳过列表内排序）
- id 传引用不传对象：`ObjectDetail({ objectId })`、`NoteView({ noteId })` —— 组件内部自己从 store 取对象，选中态变化自动重渲染
- 回调 prop 命名 `onXxx`（`TagInput` 的 `onChange(ids: string[])`）；带默认值的可选 prop 必须给默认值（`crossObject = false`、`presorted = false`）
- store 订阅只取需要的字段：`useUiStore((s) => s.view)`，禁止整个 store 返回（会造成无谓重渲染）

---

## Styling Patterns

- Tailwind 4 + 设计 Token（`src/index.css` 附录 A 契约）：**语义色类**（`bg-background` / `text-muted-foreground` / `border-border` / `bg-card`），禁止裸色值（如 `text-gray-500`）
- 暗色由 `html.dark` 类驱动（`src/main.tsx:10-16` applyTheme），组件侧零感知
- **区域划分用色阶、禁止结构性分割线（08-12 起）**：侧边栏 `bg-sidebar`（浅灰）vs 内容区 `bg-background`（纯白），区域间不用 `border-r/border-b`；元数据/信息块用 `bg-muted/50 rounded-md`（如 `ContentHeader.tsx` 来源元数据块）；表单底部操作栏 `bg-muted/50` 替代 `border-t`
  - **保留边框的例外**：内容卡片（笔记卡片 `NoteCardList.tsx:89`、设置页卡片）与内容语义线（Markdown 的 hr/表格）
  - **色阶 token 选值需实测对比（08-12 教训）**：`--sidebar: #fafafa` 与纯白仅差 2%（肉眼不可辨）被用户否决；后加深至 `#f0f0f0`。选 token 时用 `getComputedStyle` 对比相邻区域背景（差值 <5% 视为不可辨），不要凭视觉近似拍脑袋
- 紧凑密度统一：行 `h-7`、icon 按钮 `size="icon-sm"`、角标 `h-4.5 px-1 text-[0.7rem]`（`NoteCardList.tsx:153-175`）
- **无横向滚动**三件套：滚动容器 `min-w-0`、长文本 `truncate`（配合 `title` 属性显示全文，`NoteCardList.tsx:93`）、flex 子项 `shrink-0` 控制收缩
- 装饰器样式类（`.sn-md-dim` / `.sn-md-hidden` 等）只定义在 `src/components/Editor/markdownDecorations.ts:30` 的 `markdownEditorTheme`，全部语义色 CSS 变量，不硬编码色值

---

## Accessibility

- 可点击卡片是 `role="button"` + `tabIndex={0}` + Enter 键盘处理（`NoteCardList.tsx:96-101`）
- icon-only 按钮必须有 `aria-label`（如 `aria-label="删除笔记"`，`NoteCardList.tsx:105`）；图标统一 lucide `data-icon` 属性（全局 CSS 统一尺寸）
- 删除/归档等破坏性操作一律 `AlertDialog` 确认（内容明确 + 数量提示，见 error-handling.md）
- Dialog 用 `DialogClose`、Popover 用 `onOpenAutoFocus`/`onCloseAutoFocus` 阻止焦点劫持（`TagInput.tsx:171-172`）
- 选中高亮用 `data-selected` 属性驱动（`SidebarRow.tsx`），不用内联样式

---

## Editor / CodeMirror 装饰（08-13-perf-smoothness 起）

**装饰必须语法树驱动，禁止正则全量重扫**：

- 装饰从 lezer 语法树派生（`syntaxTree(state)` 单遍遍历 + RangeSetBuilder），解析器增量更新（只重解析变化区），5000 行 0.14ms vs 正则版 2.45ms（17.8 倍）
- 结构基础：嵌套层级（ListItem 祖先链）、表格/任务/围栏等块结构天然可得，后续 WYSIWYG Widget（图片/表格/代码块）都依赖语法树
- 启用 GFM：`markdown({ extensions: [GFM] })`（CodeMirrorEditor.tsx），否则语法树无 Table/TaskList 节点

**节点映射要点**（实测 dump 确认）：

- `ATXHeading1..6` → `HeaderMark`（标记范围**不含**后续空格，与正则版 `# ` 不同）；5/6 级复用 h5/h6 样式
- `Emphasis/StrongEmphasis` → 首尾 `EmphasisMark` dim + 中间隐式文本区间（**隐式文本无节点**，按位置区间处理）
- `Link/Image` → 首 `LinkMark` dim、文本区 linkMark、剩余 dim（LinkMark 序列含 URL 子节点）
- `ListItem` → `ListMark`（无序替换 BulletWidget 含后续空白 / 有序 dim）；`Task(TaskMarker)` 复选框 Widget
- `Table` → 表头行 head+first、分隔行 sep、数据行 row+last、行内 `TableDelimiter` dim；**不递归 Table 内部**（单元格内不 scanInline）
- `FencedCode` → 开 `CodeMark`+`CodeInfo` fenceMark、`CodeText` codeBlockMark、闭 `CodeMark` fenceMark

**装饰约定**：`buildDecorations(state)` 导出签名保留（headless 测试/基准共用）；ViewPlugin 全量重建（0.14ms 可忽略），DOM 增量由 CM6 RangeSet.compare 处理（实测每键 DOM 变更 3 处）。

**性能基准**：`node scripts/bench-decorations.ts`（5000 行阈值 <10ms）与 `DOC_LINES=5000 node scripts/perf-input.mjs`（真实浏览器端到端/长任务检测）是后续 child 回归对比的固定工具。

---

## Common Mistakes

- **radix Popover 用 onFocus 打开会被同点击序列误关（08-12 实测）**：点击输入框时 focus 触发 `setOpen(true)`，但 DismissableLayer 把同一点击序列的后续事件判为外部点击 → Popover 立即关闭。现象：标签联想永不显示（TagInput）。修复：`onChange` 时兜底 `setOpen(true)`（输入字符即重开）；不要依赖 onFocus 单独打开

- **组件直接碰 db**（红线）：数据必须经 store → services/db.ts。曾出现过在组件里 import services 的倾向，已被分层规则拦下；唯一例外是 `lib/sourceTypes.ts` 的只读缓存 hook
- **每卡自建投影 Map**：`NoteCardList.tsx:67` 的 `tagById` 在列表级构建一次传给卡片，禁止每张卡内 `tags.find()`（O(N²)）
- **复制列表形态**：AC3 要求 1 条与 20 条渲染一致，新增列表场景必须先问"能否复用 NoteCardList"，禁止另写一套卡片
- **装饰增量重建（08-13 实测回退）**：不要手工做「变化行局部重建 + 旧装饰 map 复用」——RangeSetBuilder 对重叠 range 分层存储（nextLayer），`between` 复制时主层与 nextLayer 分开回调导致 from 逆序，抛 `Ranges must be added sorted by from and startSide`；且实测 CM6 compare 本就只 diff 变化部分，增量无端到端收益。全量重建（语法树 0.14ms/5000 行）就是最优解
- **headless 测装饰不挂 language 扩展**：`syntaxTree(state)` 依赖 state 里的 language 扩展，`EditorState.create` 裸建（无 `markdown({extensions:[GFM]})`）时语法树为空 → 装饰空。smoke/bench 的 state 必须带 LANG_EXT
- **裸色值/硬编码圆角字号**：一律走语义 Token 与 tailwind 标准 spacing/radius；装饰器样式只进 `markdownEditorTheme`
- **弹窗承载表单**：800×600 下弹窗空间不足，新建对象/笔记表单是**全内容区替换**（`ContentArea.tsx:129-131` 编辑态优先），Dialog 只用于确认与短表单（标签别名编辑）
