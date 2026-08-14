# Editor Architecture (CodeMirror 6 Live Preview / atomic-editor)

> 编辑器实现契约。历史：Milkdown (Crepe) WYSIWYG 迁移被否决（块编辑体验，
> 用户要 Typora 式"纯 markdown 的视觉丰富"），已回滚（94cbfec）并落地
> Obsidian Live Preview 式即时渲染（任务 08-14-editor-ux-rebuild 第二路线）。

## Architecture Overview

```
NoteView（保存链路不变：onChange(md) → draft → 500ms 防抖 → updateNote）
  ├─ MarkdownToolbar（20 项）──→ MarkdownInsertApi（codeMirrorApi 实现，jumpTo=offset）
  ├─ MetaInfoPanel（大纲：onJump(offset)）
  └─ AtomicEditor（@atomic-editor/editor 0.6.x，CM6 内核）
       ├─ atomic 内置：live preview（光标行源码/其余渲染）、表格、任务勾选框、代码围栏高亮、readOnly
       ├─ mathExtension.ts（自研标准 `$...$`/`$$...$$`，KaTeX）
       └─ 只读态（归档）：同组件 readOnly（不渲染 MarkdownView）
```

- 文档模型 = 纯 Markdown 源文本：即时渲染只改视图不改文档，**round-trip 字节级一致**。
- 无块编辑形态：无斜杠命令、无块手柄（R11 硬约束）。
- 已删除：CM6 自研装饰（markdownDecorations.ts）、自研表格 widget（markdownBlockWidgets.ts）、
  MarkdownView 正则渲染器、lib/markdown.ts、@uiw/react-codemirror 壳。

## Component Contract: AtomicEditor

File: `src/components/Editor/AtomicEditor.tsx`

```tsx
interface AtomicEditorProps {
  value: string            // 受控 markdown；外部变化（切笔记）→ handle 重写
  onChange(value: string)
  onSave?: () => void      // Ctrl/Cmd+S（编辑器内焦点）
  placeholder?: string
  autoFocus?: boolean
  readonly?: boolean       // 归档只读：readOnly + transactionFilter 拦截一切 doc 改动
  className?: string
}
```

- 受控 value 同步：切笔记走 `documentId` remount 或 handle 重写，避免光标/历史残留。
- **归档只读不可变性**：atomic 原生 readOnly 仍允许勾选任务框 → 产品要求"归档不可变"，
  用 transactionFilter 拦截勾选框改动（已实现，勿回退）。
- editorHandle 逃生口：`EditorView.findFromDOM(handle.getContentDOM())` 取 view 实现工具栏 API。

### MarkdownInsertApi（codeMirrorApi.ts，工具栏契约）

```ts
interface MarkdownInsertApi {
  wrap(before, after?, placeholder?): void   // 选中包裹（markdown 文本）
  block(prefix, suffix?, opts?): void        // 行级命令 / 块级插入（公式块 $$、围栏、表格模板、hr）
  insertImage(path: string): void
  jumpTo(offset: number): void               // CM6 文档偏移定位（滚动 + 光标）
  focus(): void
}
```

## mathExtension.ts（自研标准公式，独立可替换）

- **语法**：行内 `$x$`、块级 `$$x$$`（单行）与 `$$\n...\n$$`（多行）。
- 实现：lezer markdown 扩展 + StateField 装饰（**CM6 规则：block 装饰必须来自 StateField，
  ViewPlugin 会抛 "Block decorations may not be specified via plugins"**）。
- 语法边界（正则在 lezer Paragraph/ATXHeading* 内扫描，排除 InlineCode/Link/Image 区间）：
  - 开 `$` 非转义、后非空白非 `$`；闭 `$` 前非空白；内容无 `$`/换行且非空
  - 未闭合 `$`、`a $ b`、`$ a$`、`$a $` 均不渲染；`$$` 双美元互斥回退源码
- 光标行揭示：selection 覆盖的行/块显示源码；readOnly 恒渲染不揭示。
- 点击渲染结果 → mousedown preventDefault + selection 移入源码。

### 块 widget 高度契约（重要，勿破坏）

KaTeX `.katex-display` 自带 `1em` margin → 块 widget 盒外间距导致 heightmap 与 DOM 坐标
差 16px → 块下方方向键/点击 Y→位置映射错位。已修复并固化：
- `.cm-math-block`：flex 居中 + margin 清零 + `min-height: N × 行高`（多行块替换 N 行时）

## 主题

`--atomic-editor-*`（~30 个 CSS 变量）在编辑器容器祖先映射项目 Tailwind 色板
（--background/--foreground/--muted 等），`.dark` 作用域覆盖。见 `atomicTheme.css`。

## 代码块语言（R4 现状）

- atomic 围栏渲染 + 语法高亮（内置 5 语言：js/ts/css/html/md）。
- 语言切换 = 光标行源码编辑围栏语言标签（**无浮层**，D4 最小方案；AC4 按此口径）。
- 注意：`codeLanguages` 只传已装语言包；`ATOMIC_CODE_LANGUAGES` 含未装包会 build 失败。
  加语言需同步安装 `@codemirror/lang-*`。

## Gotchas

> **block widget 垂直导航**：公式块上方方向键会"停靠"到块起点（CM6 block-widget 固有行为，
> atomic 表格同理）——无错位，可接受；如后续优化可自定义 moveVertically。

> **KaTeX 字体裁剪**：vite.config.ts 的 `katexWoff2Only` 插件构建期剔除 woff/ttf 引用，
> 只留 woff2（1.02MB → 0.24MB）。换 KaTeX 版本时确认插件仍生效。

> **playwright 测试**：打开笔记用 `dispatchEvent('click')`（dev 环境偶发 hit-test 拦截，
> 与产品逻辑无关）；编辑器断言选择器：`.cm-content`（编辑区）、`.cm-math-inline`/`.cm-math-block`
> （公式）、`.cm-atomic-task-checkbox`（勾选框）、`.cm-atomic-blockquote`、`.cm-atomic-hr`。

## Tests

- `npm run smoke:editor` — 编辑器专项（28 断言：公式/光标行源码/语法边界/勾选框/引用/分割线/
  围栏/工具栏 20 项/图片/大纲 offset/Ctrl+S/round-trip 字节一致/深色/长文档 600 行）。
- `npm run ui-smoke` — 全流程（60 断言，含公式渲染与 R11 无斜杠/块手柄）。
- 其余：smoke/smoke:stores/smoke:outline/smoke:tableModel/smoke:tableOps。
- 体积基线（2026-08-14）：dist 解压 1.68 MB / zip 0.69 MB。

## 决策记录

- **为什么不是 Milkdown/Crepe**：ProseMirror 块结构改变 markdown 逻辑（`#` 被吃掉、
  斜杠/块手柄），用户否决；CM6 live preview 是"纯源码 + 视图装饰"，满足"对纯 markdown 的丰富"。
- **为什么用 atomic-editor 而非自研装饰**：成熟实现（50+ Playwright 回归、生产实盘），
  math 缺失用自研小扩展补齐（无标准 `$` 语法的现成包；live-markdown 仅 Obsidian 语法）。
- **版本锁定**：`@atomic-editor/editor` 精确版本（0.6.x API 尚在演进）。
