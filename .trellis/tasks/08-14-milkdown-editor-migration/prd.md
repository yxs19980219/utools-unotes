# 编辑器核心迁移：CM6/atomic-editor → Milkdown（Kit 拼装）

## Goal

替换现有自研 CM6 即时渲染内核（@atomic-editor/editor 0.6.2 + 348 行自研 mathExtension），改用 Milkdown 7.22.1（Kit 拼装，ProseMirror 文档模型 + remark 序列化），获得生态级即时渲染体验，摆脱大量自研边界问题（源码/渲染双轨、高度映射、语法扫描等）。

- 不引入斜杠命令（不装 plugin/slash）
- 不引入块拖拽（不装 plugin/block；Crepe 的 BlockEdit feature 不用）
- 保留「纯 markdown 编辑 + 即时渲染」的 Typora 式交互（markdown 语法输入即时生效）
- 对外契约（NoteView/MarkdownToolbar/MetaInfoPanel）尽量零改动，改动集中在新编辑器壳 + 工具 API 实现

## Background（已确认事实，证据锚点）

### 现有编辑器现状
- 编辑壳：`src/components/Editor/AtomicEditor.tsx`（186 行）——props：value/onChange/onSave/placeholder/autoFocus/className + forwardRef<MarkdownInsertApi> + documentId（切笔记 remount）+ readOnly（updateFilter 拦截一切 doc 改动）
- 工具 API：`src/components/Editor/codeMirrorApi.ts`——MarkdownInsertApi：wrap(before,after,placeholder) / block(prefix,suffix,{block,placeholder}) / insertImage(path) / jumpTo(pos) / focus()，语义为 CM6 源码编辑
- 工具栏：`src/components/Editor/MarkdownToolbar.tsx`——19 个按钮：wrap 类 8（加粗/斜体/下划线`<u>`/删除线/高亮`==`/内联代码/行内公式/链接）+ 图片、行级 7（h1-h3/无序/有序/勾选/引用）、块级 4（代码块/公式块/表格/分割线）
- 公式：`src/components/Editor/extensions/mathExtension.ts`（348 行自研）——标准 `$…$`/`$$…$$`，KaTeX 渲染 + 内容缓存 + 光标行揭示（光标所在行显示源码）+ 点击渲染结果跳回源码 + 只读恒渲染
- 主题：`src/components/Editor/atomicTheme.css`——`--atomic-editor-*` 变量映射项目 token（--foreground/--muted/--ring 等），深浅色跟随 .dark
- 消费方：`src/components/NoteView.tsx`——编辑态实例（draft 防抖 500ms 自动保存 + Ctrl+S flush + savingRef 串行化追平）+ 只读态实例（onChange noop + readOnly）；`src/components/MetaInfoPanel.tsx` + `src/lib/outline.ts`——大纲从 markdown 源码解析（offset=源码字符偏移），点击 → onJump(offset) → api.jumpTo(offset)（滚动+光标）
- 依赖：`package.json` —— @atomic-editor/editor 0.6.2、@codemirror/lang-markdown/state/view、katex 0.18.4

### Milkdown 生态事实（调研于 2026-08-14）
- 最新稳定 7.22.1，@milkdown/kit / @milkdown/crepe / @milkdown/react 同版本
- Kit 可组装：Editor.make().config(rootCtx).use(commonmark).use(gfm).use(listener)…
- 数学：旧 @milkdown/plugin-math 停更于 7.5.9；新实现在 @milkdown/crepe/feature/latex（remark-math + katex ^0.18.0，`$…$`/`$$…$$` 标准语法与现有一致），可单独借用
- placeholder：@milkdown/crepe/feature/placeholder（text + mode）
- 代码块：@milkdown/kit/component/code-block，基于 CodeMirror 6，languages 可复用现有 @codemirror/lang-* 包
- 表格：@milkdown/kit/preset/gfm + component/table-block（table-block 含拖拽手柄——本项目不用，用 gfm 基础表格节点）
- 只读：editorViewOptionsCtx editable: () => false；勾选框在只读下不可交互
- 切文档：editor.action(replaceAll(md)) 或 destroy/recreate（React key remount）
- 无内置 ==高亮== / <u> 下划线 mark（需自研 2 个 mark 插件）
- @milkdown/kit exports 已验证：preset/commonmark、preset/gfm、plugin/listener、component/code-block、component/table-block 等路径齐全，无 plugin/math

## Requirements

### R1 内核替换
- 编辑态与只读态统一使用 Milkdown 内核渲染（公式/表格/代码块/任务列表/高亮渲染一致）
- 删除 @atomic-editor/editor、codeMirrorApi.ts、mathExtension.ts、atomicTheme.css 等旧内核代码（不写兼容层、不留 fallback）

### R2 对外契约保持（零改动目标）
- AtomicEditor props 契约不变：value/onChange/onSave/placeholder/autoFocus/className/documentId/readOnly + forwardRef<MarkdownInsertApi>
- MarkdownInsertApi 接口名与语义保持不变（wrap/block/insertImage/jumpTo/focus），实现改为 ProseMirror 命令
- NoteView / MarkdownToolbar / MetaInfoPanel 不做结构性改动
- Ctrl+S 保存、draft 防抖自动保存、只读不可变行为不变

### R3 交互与功能等价
- 19 个工具栏按钮功能等价（含 `<u>` 下划线、`==高亮==` 两个自研 mark）
- 标准 `$…$`/`$$…$$` 公式即时渲染（KaTeX），光标进入公式显示源码、点击渲染结果可编辑源码
- 代码块语言高亮（复用现有 @codemirror/lang-* 包：js/ts/css/html/md）
- GFM 表格渲染（无拖拽手柄）、任务列表勾选交互、引用/列表/分割线
- 大纲跳转：点击大纲项滚动定位到对应标题（offset 契约内部重新解释，见 design）
- placeholder 提示、只读归档渲染

### R4 主题
- 编辑器视觉对齐现有设计体系：项目 token（--foreground/--muted/--ring 等）+ 深浅色 .dark 跟随，观感与现 atomicTheme 一致

### R5 依赖变更
- 新增 @milkdown/kit、@milkdown/react、@milkdown/crepe（借用 latex/placeholder feature）
- 保留 katex 0.18.4、@codemirror/lang-markdown/state/view（代码块组件用）
- 移除 @atomic-editor/editor

## Acceptance Criteria

- [ ] AC1 编辑态/只读态均用 Milkdown 内核渲染；旧内核文件（AtomicEditor 壳内实现/codeMirrorApi/mathExtension/atomicTheme）已删除，无 @atomic-editor/editor 依赖
- [ ] AC2 新建/打开非归档笔记即进入编辑态，placeholder 显示，输入 markdown（#、**、-、```、$、表格语法）即时渲染
- [ ] AC3 19 个工具栏按钮行为与现版等价（含下划线/高亮）；图片插入走现有 pickImageFile 路径
- [ ] AC4 公式：行内 `$…$` 与块级 `$$…$$` 渲染为 KaTeX；光标进入公式显示源码；只读态恒渲染
- [ ] AC5 代码块语言选择与语法高亮可用（js/ts/css/html/md）
- [ ] AC6 表格渲染正常且无拖拽手柄；任务列表可勾选（编辑态）；只读态不可修改
- [ ] AC7 大纲跳转：MetaInfoPanel 点击标题滚动定位并聚焦（含只读态）
- [ ] AC8 实时保存不回归：输入防抖 500ms 落盘、Ctrl+S 立即保存、切笔记草稿重置不串档（documentId 语义保留）
- [ ] AC9 归档笔记字节级不可变：只读态不可编辑、公式/表格/勾选框不可交互
- [ ] AC10 深浅色主题下编辑/只读渲染观感与现版一致（对照截图）
- [ ] AC11 npm run typecheck && npm run build 通过；smoke 脚本不回归（或按需更新）
- [ ] AC12 markdown 往返（编辑→序列化→保存→再打开）不丢内容：GFM 语法、公式、表格、图片、任务列表 roundtrip 后仍正确显示

## Out of Scope

- 斜杠命令（/ 菜单）、块拖拽（DnD）、AI 功能、块手柄菜单（Crepe BlockEdit）
- 源码/预览双栏模式（现版为即时渲染单栏，保持不变）
- 自动保存机制重构、笔记数据结构变更
- 编辑器搜索/替换、多光标、diff 等 CM6 高级编辑能力（现状无，不引入）

## Open Questions

- 无（待用户确认下列决策后关闭）

## Key Decisions（已拍板）

- [x] D1 主题方案：官方主题 + 变量覆盖——@milkdown/crepe/theme 官方主题，CSS 变量覆盖对齐项目 token（--foreground/--muted/--ring 等），深浅色跟随 .dark（具体选 classic/nord/frame 及覆盖清单见 design）
- [x] D2 `==高亮==` / `<u>` 下划线：保留——自研 2 个 mark 插件，工具栏 19 按钮全部保留
- [x] D3 公式交互：Milkdown 原生（光标进入公式节点显示源码），与 Typora 一致

## Open Questions

- 无
