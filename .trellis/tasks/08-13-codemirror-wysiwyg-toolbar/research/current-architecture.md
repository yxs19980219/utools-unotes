# 当前编辑器架构调查

## 调查范围

时间：2026-08-13。代码证据来自当前工作树、CodeGraph 符号关系、`package.json`、现有 smoke 脚本和历史任务 `08-13-wysiwyg-toolbar`。

## 依赖与数据流

当前安装版本：

- `@codemirror/lang-markdown` 6.5.2
- `@codemirror/state` 6.7.1
- `@codemirror/view` 6.43.8
- `@lezer/markdown` 1.7.2（由 lang-markdown 引入）
- `@uiw/react-codemirror` 4.25.11
- React 19.2.8 / Vite 8.2.1

正文数据流：

```text
NoteView draft string
      ↓ value
@uiw/react-codemirror
      ↓ EditorState.doc
CodeMirror 6 + markdown({ extensions: [GFM] })
      ↓ syntaxTree(state)
markdownDecorations.ts → DecorationSet / Widget
      ↓ onChange
NoteView draftRef + Zustand store action + 500ms debounce
```

`NoteView` 通过 `MarkdownInsertApi` 向外暴露 `wrap`、行级/块级 `block`、`insertImage`、`jumpTo`、`focus`；`MarkdownToolbar` 只调用这些 API，不直接操作文档或 DOM。

## 当前已实现行为

### 标题、列表和常见 Markdown

- `markdownDecorations.ts` 从 Lezer 语法树识别 `ATXHeading1..6`，按光标行显示标题标记，非光标行隐藏标记，内容区按级别设置字号/字重。
- 列表由 `ListItem` 节点驱动；无序标记替换为 `BulletWidget`，嵌套深度决定 `• / ◦ / ▪`；缩进空白替换为 `ListIndentWidget`。
- Lezer 的实际解析已验证：`#标题`、`-项目`、`1.项目` 都是 `Paragraph`；只有 `# 标题`、`- 项目`、`1. 项目` 才进入标题/列表节点。因此“输入语法符号后按空格才渲染”当前由解析器自然保证，而不是事务拦截。
- 已启用 `EditorView.lineWrapping`，软换行已有实现。

### 图片

`Image` 节点被 `Decoration.replace` 替换成 `ImageWidget` 的 `<img>`。路径中的括号会 URL 编码；widget 不在 `onerror` 中改 DOM，避免 CodeMirror 的 MutationObserver 将 widget DOM 变化回写正文。当前待确认点是 uTools `file://` 真实路径在目标内核中的加载行为。

### 代码块

`FencedCode` 当前只做显示装饰：

- 开/闭 `CodeMark` 使用淡色装饰；
- `CodeText` 使用等宽字体和 muted 背景；
- `CodeInfo` 被原生 `<select>` `LangPickerWidget` 替换，选项为 14 个静态语言和“无语言”；选择后 dispatch 替换 info 字符串。
- 工具栏默认插入 ```` ```ts ````。

这仍是外层 CodeMirror 的多行文本，并不是跨行 block widget 或独立嵌套代码编辑器。它满足“可在代码区输入”的弱定义，但不满足“独立代码框”的强定义（例如代码框内部专用工具栏、独立语言服务、独立焦点/撤销边界）。

### 表格

`Table` 当前被解析并按行添加背景、边框、表头/分隔符样式；光标在表格内时，在表头行首插入一个 `TableToolbarWidget`，按钮调用 `lib/tableOps.ts` 直接改写表格行文本。表格单元格仍然是外层 CodeMirror 源文本，未替换为 HTML `<table>`，没有单元格级焦点、Tab/Enter 导航或嵌套编辑器。

因此当前实现是“Markdown 源码编辑 + 表格操作工具条”，不是用户描述的“真实表格（可编辑、可增删行列）”强定义。

## CodeMirror 装饰边界

当前 `markdownDecorationPlugin` 是 `ViewPlugin`，以 `decorations: v => v.decorations` 提供装饰。官方规则：由函数间接提供的装饰发生在 viewport 计算之后，不能引入影响垂直布局的 block widget 或覆盖换行的 replace decoration。要把多行 Markdown 表格/代码块替换成真实 block 组件，装饰需要通过 `StateField`/直接的 `EditorView.decorations` 提供，并考虑 `EditorView.atomicRanges`、`WidgetType.estimatedHeight`、`coordsAt`、`destroy/updateDOM` 等生命周期。

## 当前质量基线

已执行并通过：

- `npm run typecheck`
- `npm run build`（有现存的 bundle >500 kB 警告，不是本任务新增错误）
- `npm run smoke:decorations`：10 项
- `npm run smoke:tableOps`：6 项

现有 smoke 主要证明语法树装饰和纯文本表格操作，不覆盖真实表格 widget、嵌套编辑器、焦点同步、撤销历史、复杂滚动测量或代码块独立编辑。

## 历史任务对照

归档任务 `.trellis/tasks/archive/2026-08/08-13-wysiwyg-toolbar/` 已将图片 widget、代码语言选择器、表格工具条实现为一轮 MVP，但其 `design.md` 明确选择了“源码编辑 + 工具条”，并未实现真正 contentEditable/HTML 表格。当前需求中的“真实表格”若按强定义理解，属于在该 MVP 之上的架构升级，不是简单补几个按钮。
