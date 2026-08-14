# Editor Architecture (Milkdown 7.22.1 / CrepeBuilder 即时渲染)

> 编辑器实现契约与历史：Milkdown 曾两次尝试——
> ① Crepe 完整框架（79a0425，含默认 BlockEdit 块手柄）→ 用户否决「块编辑体验」回滚（94cbfec）；
> ② 本次（08-14-milkdown-editor-migration，d9dfb6d）用 CrepeBuilder 只装配所需 feature，
> 明确排除 block-edit/slash/拖拽，满足「纯 markdown 编辑交互 + 即时渲染」。

## Architecture Overview

```
NoteView —— 双向链路：onChange(md) → draft → 500ms 防抖 → updateNote；
  ├── MarkdownToolbar（20 项）→ MarkdownInsertApi（markdownInsertApi 实现，ProseMirror 命令）
  ├── MetaInfoPanel → 大纲 onJump(OutlineItem)（level+text 匹配标题，非源码偏移）
  └── MilkdownEditor（CrepeBuilder 装配）：
       ├── codeMirror feature：代码块（复用 @codemirror/lang-*，CM6 内核）
       ├── latex feature：$…$/$$…$$ 公式（KaTeX 预览；$$ → code_block lang=LaTeX）
       ├── placeholder feature + listItem feature（勾选框渲染 + 点击 toggle）
       ├── 自研 customMarks：==高亮== / <u>下划线</u>（remark 转换 + mark schema + 序列化）
       ├── 只读：setReadonly（editable=false，勾选框/表格天然不可交互）
       └── 受控：documentId 变化重建（父组件 key + effect 双保险）
```

- 文档模型 = ProseMirror（WYSIWYG），序列化 roundtrip 有语法规范化（如 `$$` 块 → ```latex
  围栏、列表标记 `-`→`*`、分割线 `---`→`***`），内容不丢（AC 以内容保留为准）
- 无块编辑形态：无 slash / 无 block-edit 手柄 / 无拖拽（R11 硬约束）
- 输入规则驱动解析：`# `、`- `、`> `、`---`、`$x$`、`[ ] ` 等逐键触发
  （整段 insertText/粘贴纯文本不触发 input rules → 按源码显示）

## Component Contract: MilkdownEditor

File: `src/components/Editor/MilkdownEditor.tsx`

```tsx
interface MilkdownEditorProps {
  value: string            // 受控 markdown（外部变化仅切笔记/草稿重置触发）
  onChange(value: string)
  onSave?: () => void      // Ctrl/Cmd+S（编辑器内焦点；表单 window 监听兜底）
  placeholder?: string
  autoFocus?: boolean
  readonly?: boolean       // 归档只读（CrepeBuilder setReadonly）
  className?: string
  documentId: string       // 文档身份：变化时重建（光标/undo 不串笔记）
}
```

- 装配：CrepeBuilder 已内置 commonmark/gfm/listener/history/indent/trailing/clipboard/upload；
  `builder.editor.config(...).use(...)` 追加自研插件（customMarks、Mod-s keymap）
- **feature 顺序敏感**：latex feature 强制要求 CodeMirror flag（`useCrepeFeatures` 检查），
  必须先 addFeature(codeMirror) 再 addFeature(latex)
- 受控回写：`listener.markdownUpdated`（200ms 防抖于框架内）→ onChange；
  value 兜底 effect 需等 create() 完成（editorViewCtx 就绪）后再 getMarkdown 对比，否则崩溃

### MarkdownInsertApi（markdownInsertApi.ts）——ProseMirror 命令实现

```ts
interface MarkdownInsertApi {
  wrap(before, after?, placeholder?): void   // toggleMark / 链接 / math_inline 插入
  block(prefix, suffix?, opts?): void        // setBlockType / wrapInList / wrapInBlockquote / 节点插入
  insertImage(path: string): void            // image 节点（alt=文件名去扩展）
  jumpTo(item: OutlineItem): void            // level+text 匹配 heading 节点定位（非偏移）
  focus(): void
}
```

- wrap 的 before → mark 名映射：`**`→strong、`*`→em、`~~`→strike_through、`` ` ``→inline_code、
  `==`→highlight、`<u>`→underline、`[`→link、`$`→math_inline 节点
- 节点名注意：分割线是 `hr` 不是 `horizontal_rule`；公式块 = code_block + language 'LaTeX'
- 所有命令经 `editor.action(ctx => view...)` 且检查 `view.editable`（只读态 no-op）

## customMarks.ts（==高亮== / <u>下划线</u>）——自研扩展 mark

- 解析：`$remark` 转换插件（unist-util-visit）——text 节点 `==x==` 拆 highlight 节点；
  **`<u>` 被 remark-parse 拆成两个 html 节点**（`<u>` + `</u>`），需在 parent.children 中
  成对查找合并为 underline 节点
- **陷阱：`'==x=='.split(/(==[^=]+==)/g)` 产出空串片段，必须 filter 掉**——
  空 text 节点导致 ProseMirror 解析报错 `Empty text nodes are not allowed`（编辑态输入走
  input rule 不触发，只在重开/只读解析时暴露）
- 序列化：remarkStringifyOptionsCtx 的 handlers（mdast-util-to-markdown 2.x 的 State 无
  `all()`，用 `containerPhrasing(node, info)`）输出 `==x==` / `<u>x</u>`
- 编辑：toggleMark 命令 + 输入规则（`==x==`、`<u>x</u>` 自动激活）

## 公式（latex feature）

- 行内 `$x$` → math_inline 节点（input rule 触发）；`$$` + Enter → code_block lang=LaTeX
  （数学块 = 代码块 + LaTeX 语言 + renderPreview 预览，非独立节点）
- 光标进入公式节点显示源码（Typora 式）；代码块退出用 **Ctrl+Enter（exitCode）**，
  ArrowDown 在 CM6 块内行为不稳定
- 代码块组件渲染预览的条件：selection 离开块（挂载后组件 watch [text, language] immediate
  计算预览内容；编辑态 CM 编辑器 + 预览面板并存）

## 主题

`--crepe-color-*`（官方 classic 主题变量）→ 项目 token 映射（milkdownTheme.css），
`.dark` 作用域覆盖，Chromium 108 兼容（rgba 先行 + color-mix 覆盖）。

## 已知限制（测试与输入注入相关）

- Playwright `keyboard.insertText` 整段注入：\n 不产生换行（成 hardbreak）、不触发 input
  rules（`- ` 列表等不转换）——smoke 用逐行 insertText + Enter 或逐字符 type
- 快速 insertText 含公式行（`$x_i$`）+ input rule 组合触发 ProseMirror
  `Position out of range`（真实逐字输入无此问题）——长文档 smoke 行内不含公式
- task 勾选框选择器：`.milkdown-list-item-block .label`（.unchecked/.checked 区分状态），
  组件 DOM 无 data-item-type 属性
