# 设计：CM6 即时渲染（atomic-editor 低层组合 + 自研公式）

## 总体策略

新建 `AtomicEditor.tsx`，**自组 CM6 EditorView**，用 `@atomic-editor/editor` 导出的
拆散扩展装配装饰层，自研公式/下划线扩展补缺口，替换 `MilkdownEditor.tsx`。

```
MilkdownEditor (ProseMirror)  ──替换──▶  AtomicEditor (CM6 EditorView)
                                              ├─ atomic-editor 拆散扩展（inlinePreview/tables/imageBlocks/…）
                                              ├─ 自研 mathExtension（KaTeX，标准 $/$$）
                                              ├─ 自研 underline 装饰（<u>）
                                              ├─ 主题：CSS 变量映射项目 shadcn 色板
                                              └─ MarkdownInsertApi：CM6 源码偏移命令
```

## 关键决策

### D1 低层组合而非 React 组件（决定性）

`AtomicCodeMirrorEditor` 组件的句柄只暴露 `focus/undo/redo/openSearch/getMarkdown/
setReadOnly`，**不暴露 EditorView，无法 dispatch 文档变更**。而 `MarkdownInsertApi`
的 `wrap/block/insertImage/jumpTo` 都必须 dispatch changes。

故采用低层组合：自组 `EditorView`，用 atomic-editor 导出的扩展（`index.ts` 已全部
导出：`inlinePreview/highlightMarkdown/imageBlocks/tables/atomicEditorTheme/
atomicMarkdownSyntax/autoCloseCodeFence/extendEmphasisPair/startAsteriskList/
readOnlyExtension/readOnlyFacet`）。持有 `view` 引用即可实现全部插入命令 + 受控兜底。

### D2 受控语义：NoteView 按 noteId 重挂载

atomic-editor 的 `markdownSource` 仅在挂载时读取（非受控）。切笔记时 NoteView 的
`draft` state 滞后一拍（旧笔记内容），直接传 `value` 会导致新编辑器挂载成旧内容。

解法：**`ContentArea` 给 `NoteView` 加 `key={activeNoteId}`**，切笔记即整组件重挂载，
`draft` 初始值 = 新笔记 `content`，编辑器随之重挂载读正确初始值。同时删除 NoteView 中
「重置 draft 的 useEffect」（重挂载自动处理）与编辑器的「受控兜底」（不再需要）。

副作用核对：NoteView 卸载 flush（`useEffect` cleanup）在 key 变化时照常执行，旧笔记
未落盘内容仍会保存；`savingRef` 串行化在重挂载后各自独立，保存闭包持有旧 `noteId`，
不串笔记。

### D3 公式：自研轻量 KaTeX 扩展（标准 `$...$` / `$$...$$`）

标准 `$` 语法 @lezer/markdown 不解析，须自研。CM6 `ViewPlugin` 扫描源码：

- 行内 `$...$`：非光标行用 `Decoration.replace` 替换为 KaTeX 渲染的 inline Widget；
  光标行显示源码。
- 块级 `$$...$$`：非光标行用 block Widget（`Decoration.widget` + block 语义）渲染；
  光标行显示源码。
- 光标行判定：复用 atomic-editor 的「光标所在行显示源码」约定——遍历非光标行，
  光标行（含选区）跳过装饰。

### D4 高亮/下划线

- `==高亮==`：atomic-editor 内置（README 明确支持）。
- `<u>下划线</u>`：atomic-editor 不支持，自研 inline `Decoration.mark` + CSS
  `text-decoration: underline`（无输入规则，仅渲染；源码保留 `<u>` 原文，round-trip 天然一致）。

### D5 主题

atomic-editor 通过 `--atomic-editor-*` CSS 变量主题化，支持 `[data-theme="light"]`
浅色切换。本项目用 next-themes + shadcn 变量。做法：新建 `atomicTheme.css`，在
`[data-theme]` 作用域把 `--atomic-editor-*` 映射到项目色板（`--background`/
`--foreground`/`--border`/`--primary` 等）；删除 `milkdownTheme.css`。

## 组件/扩展清单（AtomicEditor 自组）

```ts
// @codemirror/view
EditorView, highlightSpecialChars, drawSelection, dropCursor, keymap,
rectangularSelection, highlightActiveLine, lineWrapping, placeholder
// @codemirror/state
EditorState, Compartment, Prec
// @codemirror/language
indentOnInput, LanguageDescription
// @codemirror/autocomplete
closeBrackets, closeBracketsKeymap
// @codemirror/commands
defaultKeymap, history, historyKeymap, indentWithTab
// @codemirror/lang-markdown
markdown, markdownKeymap, markdownLanguage
// @codemirror/search
search, searchKeymap
// @atomic-editor/editor（拆散扩展）
atomicEditorTheme, atomicMarkdownSyntax, autoCloseCodeFence, extendEmphasisPair,
startAsteriskList, imageBlocks, highlightMarkdown, inlinePreview, tables,
readOnlyExtension
// 自研
mathExtension（KaTeX） / underlineDecoration（<u>）
```

扩展顺序对齐 atomic 组件源码（`AtomicCodeMirrorEditor.tsx`），只改动：
- 追加 `placeholder(text)`（组件未内置占位提示，NoteView 有 placeholder 需求）
- 追加自研 `mathExtension` / `underlineDecoration`
- 追加 `Prec.high` 的 `Mod-s` keymap（保存回调走 ref）
- `updateListener` docChanged → `onChange(doc.toString())`
- readOnly：初始 `readOnlyExtension(readOnly)` 直接进 extensions（归档态静态，切笔记
  由 key 重挂载，无需 Compartment 动态切换）

## 边界与契约

| 契约 | MilkdownEditor（旧） | AtomicEditor（新） |
|------|---------------------|---------------------|
| props | value/onChange/onSave/placeholder/autoFocus/className/documentId/readOnly | 完全一致 |
| ref | forwardRef\<MarkdownInsertApi\> | 完全一致 |
| wrap | ProseMirror toggleMark | CM6 源码偏移包裹（选中替换 before/after；无选中插占位） |
| block 行级 | setBlockType/wrapInList | 行首插入前缀（标题/列表/引用/勾选） |
| block 块级 | 插入节点 | 光标处插入多行块文本（代码块/公式块/表格/分割线） |
| insertImage | image 节点 | 插入 `![alt](path)` 源码 |
| jumpTo | level+text 匹配（WYSIWYG 偏移失效） | **恢复 offset 语义**（CM6 源码偏移直接有效） |
| 受控 | replaceAll 兜底 | 无兜底（key 重挂载，见 D2） |

`MarkdownToolbar` / `MetaInfoPanel` / `NoteView` 契约核对：`MarkdownInsertApi` 接口
不变；`jumpTo(OutlineItem)` 改回用 `item.offset`（`OutlineItem` 已含 offset，CM6 下
直接 `dispatch({selection: {anchor: offset}, effects: scrollIntoView(offset)})`）。

## 兼容与回滚

- 存储格式不变（纯 markdown）；回滚 = `git revert` 本任务 commit。
- 依赖变更独立 commit：`npm uninstall @milkdown/crepe @milkdown/kit`；`npm install
  @atomic-editor/editor @codemirror/commands @codemirror/autocomplete @codemirror/language
  @codemirror/search @lezer/common @lezer/highlight @lezer/markdown @codemirror/lang-javascript
  @codemirror/lang-html @codemirror/lang-css`（lang-* 原为 Milkdown 间接依赖，卸载后须显式安装）。
- 分阶段 commit：① 依赖切换 + 基线可编译 ② AtomicEditor 内核 + 公式/下划线 ③ 主题/清理
  ④ 测试与体积。

## 部署/体积

- Milkdown（crepe + kit）体量较大，移除后体积应下降；atomic-editor + CM6 拆散扩展
  按需引入。目标 dist 解压 ≤ 5MB（AC13）。
