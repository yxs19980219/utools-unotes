# Editor Architecture (Milkdown/Crepe WYSIWYG)

> Editor implementation contract after the CM6 → Milkdown migration (task 08-14-editor-ux-rebuild).

## Architecture Overview

```
NoteView（保存链路不变：onChange(md) → draft → 500ms 防抖 → updateNote）
  ├─ MarkdownToolbar（19 项，UI 不变）──→ MarkdownInsertApi（Milkdown 实现）
  ├─ MetaInfoPanel（大纲跳转：onJump(index)）
  └─ MilkdownEditor（props 契约与旧 CodeMirrorEditor 兼容）
       ├─ Crepe（WYSIWYG：latex/代码高亮/GFM 表格/任务列表/slash/block-edit）
       └─ 只读态：同一组件 readonly prop（归档笔记）
```

- 编辑器内核：`@milkdown/crepe` + `@milkdown/kit`（ProseMirror + remark 双向转换）。
- 存储格式不变：`Note.content` 始终为 Markdown 文本（无数据迁移）。
- 废弃：CM6 全家（`@codemirror/*`、`@uiw/react-codemirror`）、自研装饰（markdownDecorations.ts）、
  自研 Block Widget（markdownBlockWidgets.ts）、正则渲染器（MarkdownView.tsx）。

## Component Contract: MilkdownEditor

File: `src/components/Editor/MilkdownEditor.tsx`

```tsx
interface MilkdownEditorProps {
  value: string            // 受控 markdown；外部变化（切笔记）→ replaceAll
  onChange(value: string)  // markdownUpdated（Crepe 内部 debounce）
  onSave?: () => void      // Ctrl/Cmd+S（编辑器内焦点拦截）
  placeholder?: string
  autoFocus?: boolean
  readonly?: boolean       // 归档只读（Crepe setReadonly + contenteditable=false）
}
```

### MarkdownInsertApi（markdownInsertApi.ts，工具栏契约）

```ts
interface MarkdownInsertApi {
  wrap(before, after?, placeholder?): void   // markdown 文本插入（remark 解析成节点）
  block(prefix, suffix?, opts?): void        // 行级命令 / 块级 markdown 或命令
  insertImage(path: string): void            // insertImageCommand（src=本地路径）
  jumpTo(index: number): void                // 大纲第 index 项（PM doc 遍历 heading）
  focus(): void
}
```

实现文件：`src/components/Editor/milkdownApi.ts`

- 行级：heading → `wrapInHeadingCommand(level)`；ul/ol → `wrapIn(Bullet|Ordered)ListCommand`；
  quote → `wrapInBlockquoteCommand`；task → bullet list + list_item checked 属性。
- 块级：代码块 → `insert('```ts\n\n```')`；**公式块 → `insert('```LaTeX\n\n```')`**
  （Crepe 公式块 = 语言 LaTeX 的代码块，内置 KaTeX 预览）；表格 → `insertTableCommand`；
  分割线 → `insertHrCommand`。
- wrap：统一 `insert(before + sel + after)` 解析插入；`==高亮==` 无 schema 保留源码文本；
  `<u>` 由 html 节点渲染。

## Design Decisions

### D1: 迁移 Milkdown (Crepe) 而非增强 CM6

**Context**: 编辑器体验割裂（公式/任务/引用/代码块/分割线不渲染）。用户要 Typora 级即写即所见。

**Options**: ① CM6 生态增强（cm6-math、语言包、replace 装饰）——仍是源码编辑，体验上限低；
② Milkdown/Crepe WYSIWYG——官方 feature 全覆盖，重写但一次到位。

**Decision**: ②。体积增量实测 zip +1.5MB（0.37→1.9MB），远低于 uTools 20MB 上限。

### D2: 生命周期自管理，不用 @milkdown/react 的 useGetEditor

**Context**: React StrictMode 双挂载（mount→cleanup→mount）下，官方 useGetEditor 的
create/destroy 存在竞态——**间歇性编辑器完全不渲染**（实测多次复现）。

**Decision**: `MilkdownEditor` 内自管理：

```tsx
useEffect(() => {
  const crepe = new Crepe({ root: container, defaultValue, ... })
  let disposed = false
  void crepe.create().then((editor) => {
    if (disposed) { void crepe.destroy(); return }   // 孤儿实例自毁
    editorRef.current = editor
  })
  return () => { disposed = true; void crepe.destroy() }
}, [])
```

后挂载实例必然生效；先挂载的孤儿实例在 resolve 后自毁。已修复且 smoke 稳定。

### D3: 受控 value 防循环

- `lastValueRef` 记录最后一次 markdownUpdated 回写值；外部 value 与之一致则跳过 replaceAll。
- 注意：Crepe 的 markdownUpdated 有内部 debounce，输入刚结束时 lastValueRef 可能滞后——
  replaceAll 以"当前 value 与上次回写不一致"为条件，不会无限循环（round-trip 稳定内容收敛）。

### D4: 大纲跳转契约改为 index

- MetaInfoPanel 原传 `offset`（markdown 字符偏移）；WYSIWYG 下无稳定 mdOffset↔PM 位置映射，
  改为"大纲项序号"：`onJump(i)` → PM doc 遍历第 i 个 heading → `TextSelection.near` + `tr.scrollIntoView()`。

## Gotchas

> **公式块不是独立节点**：Crepe 的 block math = code_block 节点 + `language: "LaTeX"`
> （KaTeX 预览面板）。插入用 ```` ```LaTeX ````，别用 `$$...$$`（会被解析成 fence）。

> **代码块退出**：ProseMirror code_block 内 Enter 是换行，两次 Enter 不退出。
> 退出方式：ArrowDown 到末尾离开 / 点击代码块外部。

> **`@import` 包路径的 CSS 在 lightningcss 报错**：Crepe 样式在 TS 侧
> `import '@milkdown/crepe/theme/common/style.css'`，主题变量覆盖放独立 css。

> **playwright hit-test 偶发拦截**：dev 环境点击卡片/按钮偶发"html intercepts pointer events"。
> 测试用 `dispatchEvent('click')` 绕过；与产品逻辑无关。

> **Crepe 主题色 = CSS 变量**：`.milkdown { --crepe-color-* }` 映射项目 Tailwind 色板，
> `.dark .milkdown` 覆盖深色。见 `milkdownTheme.css`。

## Tests

- `npm run smoke:editor` — 编辑器专项（公式/深色/大纲/工具栏 19 项/图片/Ctrl+S/round-trip）。
- `npm run ui-smoke` — 全流程（含 WYSIWYG 断言：`.milkdown h1`、`.milkdown-list-item-block .label`、
  `.milkdown-code-block`、`.milkdown table`）。
- 关键选择器：`.milkdown .ProseMirror`（编辑区）、`.milkdown .katex`（公式）、
  `.milkdown .language-button`（代码块语言）、`.milkdown blockquote` / `hr` / `strong` / `em`。
