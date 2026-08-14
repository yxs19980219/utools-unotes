# 编辑器体验重构（重新规划：CM6 即时渲染路线）

## Goal

将笔记编辑体验升级为 **Typora/Obsidian Live Preview 式即时渲染**：纯 Markdown 源码编辑
（存储与 round-trip 保持用户原文），非光标行渲染为视觉样式，光标行显示源码可编辑。
**明确不做块编辑器**（无斜杠命令、无块手柄、无块结构转换）。

## 背景与决策历史

- 第一轮（已提交 79a0425）：迁移 Milkdown (Crepe) WYSIWYG——用户否决：
  Notion 式块编辑体验（斜杠菜单/块手柄/`#` 被吃掉），改变 markdown 逻辑，非所愿。
- 用户核心诉求：**对纯 markdown 的视觉丰富**（即时渲染），而非改变文档模型。
- CM6 生态调研结论（Phase 1.2，2026-08-14）：有成熟现成方案，无需自研装饰：
  - `@atomic-editor/editor`（v0.6.2，2026-07 活跃，周下载 ~4k）：React + CM6，
    Obsidian Live Preview（光标行源码/其余渲染），WYSIWYG 表格、任务勾选框、代码高亮、
    `==高亮==`、只读阅读模式（readOnly）、~50 个 Playwright 回归、作者产品 Atomic(1554★)实盘。
  - `codemirror-live-markdown`（v0.5.1 alpha）：纯 CM6 扩展，含 **KaTeX 公式（行内/块）**、
    表格、代码块（lowlight）、图片、链接——公式模块可单独挂载补齐 atomic-editor 缺口。
  - 备选（未选）：@fedoup/markdown-editor（功能少）、codemirror-markdown-hybrid（小众）、
    ProseMark（偏 VSCode）。
- 回滚策略：`git revert 79a0425` 恢复 CM6 基线（含旧自研装饰系统，集成后整体替换内核）。

## Requirements

- R1 行内公式（`$...$`）与公式块（`$$...$$`）以 KaTeX 渲染；光标行显示源码。
  （2026-08-14 决策：标准 `$` 语法。live-markdown 仅支持 Obsidian 语法且无现成
  标准语法包 → 自研轻量公式扩展 `mathExtension.ts`（lezer math 解析 + KaTeX widget，
  独立文件可替换；原型已验证与 atomic 装饰共存无冲突））
- R2 任务列表渲染为可点击切换的勾选框；光标行显示 `- [ ]` 源码。
- R3 引用渲染为引用块样式（无 `>` 残留）；光标行显示源码。
- R4 代码块语法高亮；语言选择交互观感合理（浮层式）。
- R5 分割线（`---`）渲染为水平线；光标行显示源码。
- R6 无整行灰底高亮（遵循 live preview 视觉习惯）。
- R7 文档模型 = 纯 Markdown 文本：**编辑回写不改变用户原文格式**
  （即时渲染只改视图，不改文档——优于 Milkdown 的 remark 序列化）。
- R8 工具栏 19 项、Ctrl+S、500ms 防抖保存、大纲跳转（offset 契约恢复）、图片插入（本地路径）保持。
- R9 归档只读态用同一内核渲染（atomic-editor readOnly 或等效）。
- R10 深浅色主题适配项目色板。
- R11 无块编辑形态（无斜杠命令/块手柄/块转换 UI）。

## 技术路线（已定）

1. `git revert 79a0425` 回滚 Milkdown 迁移 → 恢复 CM6 基线（CodeMirrorEditor、
   自研装饰/widget、MarkdownView、offset 大纲契约、旧 ui-smoke）。
2. 集成 `@atomic-editor/editor` 作为编辑内核（React 组件或拆散的 CM6 扩展），
   替换自研装饰/widget 系统；`codemirror-live-markdown` 的 `mathPlugin`/`blockMathField`
   挂载补公式（KaTeX）。
3. MarkdownInsertApi 契约保留（CM6 实现，jumpTo 用 offset）；工具栏/MetaInfoPanel/NoteView
   尽量零改动。
4. 只读态（归档）→ atomic-editor readOnly；删除 MarkdownView 或保留待定（原型验证后定）。

## Acceptance Criteria

- [ ] AC1 公式（行内/块）非光标行 KaTeX 渲染、光标行源码可编辑。
- [ ] AC2 任务列表勾选框渲染 + 点击切换写回 `[x]`；无 `-` 残留（非光标行）。
- [ ] AC3 引用块渲染；`>` 仅光标行可见。
- [ ] AC4 代码块语法高亮；语言选择浮层交互。
- [ ] AC5 `---` 渲染为水平线（非光标行）。
- [ ] AC6 编辑区无整行灰底。
- [ ] AC7 编辑→保存→重载 round-trip：**源文本字节级一致**（非光标行无 markdown 序列化改写）。
- [ ] AC8 工具栏 19 项可用；Ctrl+S；防抖保存；大纲跳转（offset）定位正确。
- [ ] AC9 归档只读渲染一致（公式/高亮/表格）。
- [ ] AC10 深浅色主题可读。
- [ ] AC11 无斜杠命令/块手柄（R11 验收）。
- [ ] AC12 typecheck/build/全部 smoke/ui-smoke 通过。
- [ ] AC13 dist 解压 ≤ 5 MB（预计 ~1.5-2MB，原型实测）。

## Out of Scope

- 块编辑器形态（Milkdown/ProseMirror 路线永久排除）。
- mermaid 流程图、双栏分屏、源码/预览切换按钮。
- 协作（Y.js）、云同步、数据迁移（存储格式不变）。

## Open Questions（原型验证后关闭）

- [x] O1 atomic-editor 与公式扩展共存兼容性：**已验证可行**（组件态 extensions 挂载；
  自研标准语法公式扩展与 inlinePreview 无冲突）。公式语法决策：标准 `$...$`/`$$...$$`（用户拍板 B）。
- [x] O2 主题适配：atomicEditorTheme 用 `--atomic-editor-*` CSS 变量，祖先容器映射项目变量即可，
  浅色/`.dark` 均实测生效。
- [x] O3 只读态：atomic `readOnly` 可行（contenteditable=false、公式仍渲染），MarkdownView 可删。
- [x] O4 体积实测：dist 解压 2.60 MB / zip 1.32 MB（JS 1.46MB + CSS 0.15MB + KaTeX 字体 1.02MB；
  裁剪字体后 ~1.84MB 解压）。AC13 满足。

## 关键风险

- atomic-editor v0.6.x 较新：API 稳定性（原型锁定版本）。
- mathPlugin 为 alpha：仅取公式模块，隔离封装（独立扩展文件，可替换）。
- live preview 对超长文档的性能：作者有 CLS/滚动测试，原型长文档冒烟。
