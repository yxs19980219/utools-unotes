# 编辑器体验重构与渲染方案选型

## Goal

将笔记编辑体验从"裸显语法字符的源码编辑"升级为接近 Typora 的所见即所得（WYSIWYG），公式、代码高亮、任务列表、引用、分割线等在编辑态即渲染；同时统一只读态渲染，消除割裂感。

## Background（已确认事实，来自代码库勘察）

- uTools 插件（`public/plugin.json`，single 模式，height 600），Vite + React 19 + Tailwind v4 + zustand，`next-themes` 深浅色。
- 当前编辑内核 CodeMirror 6：`@codemirror/state` / `@codemirror/view` / `@codemirror/lang-markdown` + `@uiw/react-codemirror`，入口 `src/components/Editor/CodeMirrorEditor.tsx:68`。
- 自研编辑态渲染（迁移后整体废弃）：
  - `src/components/Editor/markdownDecorations.ts` — 语法树装饰（引用边框、围栏代码块、表格淡化等）。
  - `src/components/Editor/markdownBlockWidgets.ts` — 自研表格/代码块 Block Widget（嵌套 CM6 编辑），约 800 行。
- 只读态（归档笔记）`src/components/MarkdownView.tsx:233` 为手写正则解析器（无公式/高亮/完整 GFM）。
- 笔记存储：`Note.content` 为纯 Markdown 源文本（utools.db）；非归档恒编辑态（`NoteView.tsx:58`，无编辑/预览切换）。
- 工具栏 `MarkdownToolbar.tsx:116` 通过 `MarkdownInsertApi`（`CodeMirrorEditor.tsx:44`：wrap/block/insertImage/jumpTo/focus）操作编辑器，UI 与内核解耦，19 项工具。
- `NoteView.tsx` 保存链路：onChange(markdown) → draft → 500ms 防抖保存 + Ctrl+S + 卸载 flush。
- 体积实测（vite build）：当前 dist 1.20 MB 解压 / 0.37 MB zip；Milkdown 全功能（Crepe + KaTeX + Prism）3.87 MB 解压 / 1.82 MB zip。上架展示大小 ≈ zip 大小，远低于 20 MB 上传限制。

## 用户痛点（本期全部覆盖）

1. 行内公式（`$...$`）与公式块（`$$...$$`）无法渲染 → R1
2. 任务列表勾选框前裸显 `-` → R2
3. 引用前裸显 `>` → R3
4. 代码块无语法高亮；语言选择器为整行突兀 widget → R4
5. 分割线（`---`）不渲染 → R5
6. 光标行灰色背景（CM6 activeLine）不适 → R6
7. 整体缺乏 Typora 式即写即所见 → R7

## Requirements

- R1 行内公式与公式块在编辑态与只读态均以 KaTeX 渲染。
- R2 任务列表渲染为可点击切换的勾选框，不裸显 `- [ ]` 语法。
- R3 引用渲染为引用块样式，不裸显 `>`。
- R4 代码块带语法高亮；语言选择为浮层式交互（非整行 widget）。
- R5 分割线渲染为水平线。
- R6 取消光标行灰底高亮（WYSIWYG 下无该视觉干扰）。
- R7 编辑态整体为所见即所得；Markdown 源文本仍为唯一存储格式，保存链路不变。
- R8 工具栏 19 项快捷插入、Ctrl+S、防抖保存、大纲跳转、图片插入（uTools showOpenDialog）行为保持。
- R9 只读态（归档）用同一渲染内核（公式/高亮等一致）。
- R10 深浅色主题适配。

## 技术路线（已定）

迁移 Milkdown v7（ProseMirror 内核 WYSIWYG），采用官方开箱即用皮肤 **Crepe**（`@milkdown/crepe` + `@milkdown/react`）：
- latex（KaTeX）公式、sugar-high/prism 代码高亮、GFM 表格、任务列表、斜杠菜单、块手柄均为官方 feature，对应痛点 1-5、7。
- 笔记仍为纯 Markdown 存储：Crepe 输入/输出 markdown 文本，`onChange(md)` 接现有防抖保存链路。
- 依赖拆除：CM6 全部依赖（@codemirror/*、@uiw/react-codemirror）、自研装饰与 widget 系统、MarkdownView 正则解析器。

## Acceptance Criteria

- [ ] AC1 编辑态输入 `$x^2$` 与 `$$...$$` 即时渲染为数学公式（KaTeX），光标进入可编辑。
- [ ] AC2 任务列表 `- [ ]` / `- [x]` 渲染为勾选框，点击可切换状态，无 `-` 字符残留。
- [ ] AC3 引用 `> xxx` 渲染为引用块（左边框样式），无 `>` 字符残留。
- [ ] AC4 代码块内文本有语法高亮；语言选择器为浮层/紧凑交互。
- [ ] AC5 单独一行 `---` 渲染为水平分割线。
- [ ] AC6 编辑区无整行灰底高亮。
- [ ] AC7 编辑产生的内容经保存/重载后仍为合法 Markdown，且往返编辑不丢内容（round-trip smoke）。
- [ ] AC8 工具栏 19 项全部可用（wrap/行级/块级/图片）；Ctrl+S 立即保存；500ms 防抖保存生效。
- [ ] AC9 大纲跳转（MetaInfoPanel）定位正确；无编辑器时 EMPTY_API 兜底不报错。
- [ ] AC10 归档只读笔记渲染与编辑态一致（公式、高亮、表格、任务列表）。
- [ ] AC11 深浅色主题下编辑器可读（通过现有主题变量适配）。
- [ ] AC12 `npm run typecheck`、`npm run build`、现有 smoke（data-layer/stores/tableOps/tableModel 等不受影响）通过；`ui-smoke` 通过。
- [ ] AC13 产物体积：dist 解压 ≤ 5 MB（zip 预计 ≤ 2.5 MB）。

## Out of Scope

- 图表类扩展（mermaid 流程图等）：本期不做，Crepe 有对应 feature 可后续启用。
- 双栏分屏预览、源码/预览切换模式：不做（保持非归档恒编辑态）。
- 协作文档（Y.js）、云同步：不做。
- 笔记数据迁移：无（存储格式不变，仍为 Markdown 文本）。

## Open Questions（随最终摘要一并决策）

- [ ] O2 迁移后，编辑回写会经 remark 序列化规范化 Markdown 格式（语义无损：列表标记 `-`/`*`、表格对齐、转义风格等可能被重排）——是否接受此行为变化。

## 关键风险与对策

- 图片本地路径在 WYSIWYG 渲染中的显示（dompurify 对 `file://` src 的过滤）：实施时验证，必要时自定义图片节点处理。
- Crepe 深浅色主题适配：用 CSS 变量覆盖现有色板。
- 大文档每次编辑全量序列化的性能：Crepe 内部 debounce；如有问题再优化。
- 表格编辑交互与现有自研 widget 有差异（WYSIWYG 内直接编辑单元格）：属预期体验变化。
