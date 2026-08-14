# Editor Architecture (CM6 + atomic-editor 0.6.2 即时渲染)

> 编辑器实现契约与历史：历经 ① 自研 CM6 装饰系统 → ② Milkdown Crepe（否决，块编辑）→
> ③ CM6/atomic-editor 组件态 → ④ Milkdown CrepeBuilder（本次换型前）→ ⑤ 本实现
> （08-14-editor-cm6-research）：CM6 内核 + atomic-editor 拆散扩展 + 自研公式/下划线。
> 根因：Milkdown 基于 ProseMirror（文档=AST，`**bold**` 星号被吃掉），CM6 文档=源码字符串，
> 装饰只改视图 → 字节级 round-trip + 简洁 Obsidian 式体验。

## Architecture Overview

```
NoteView —— 双向链路：onChange(md) → draft → 500ms 防抖 → updateNote（key 重挂载）
  ├── MarkdownToolbar（20 项）→ MarkdownInsertApi（CM6 源码偏移命令）
  ├── MetaInfoPanel → 大纲 onJump(OutlineItem)（item.offset 定位）
  └── AtomicEditor（自组 EditorView，低层组合）：
       ├── atomic-editor 拆散扩展：inlinePreview / tables / imageBlocks /
       │   highlightMarkdown / atomicEditorTheme / atomicMarkdownSyntax /
       │   autoCloseCodeFence / extendEmphasisPair / startAsteriskList
       ├── 自研 mathExtension：$…$ / $$…$$ 公式（KaTeX，StateField 装饰）
       ├── 自研 underlineExtension：<u>下划线</u>（ViewPlugin，标签隐藏 + mark）
       ├── readOnlyExtension（Compartment 动态切换，归档只读）
       └── Mod-s keymap（Prec.high）+ placeholder + CM6 内置（history/search/closeBrackets）
```

- 文档模型 = 纯 Markdown 源码（CM6 EditorState.doc）；装饰 view-only，round-trip 字节级一致
- 无块编辑形态：无 slash / 无 block-edit 手柄 / 无拖拽（R11 硬约束）
- ==高亮== 由 atomic-editor 内置；`<u>` 下划线自研（atomic 不支持）
- 只读态：readOnlyExtension（EditorView.editable=false + EditorState.readOnly + `.cm-atomic-readonly` 类）

## Component Contract: AtomicEditor

File: `src/components/Editor/AtomicEditor.tsx`

```tsx
interface AtomicEditorProps {
  value: string            // 初始 doc（仅挂载时读取，编辑器之后为真相源）
  onChange(value: string)  // updateListener docChanged → 回写
  onSave?: () => void      // Ctrl/Cmd+S（Mod-s keymap）
  placeholder?: string     // @codemirror/view placeholder 扩展
  autoFocus?: boolean
  readonly?: boolean       // readOnlyExtension（Compartment reconfigure）
  className?: string
  documentId: string       // 文档身份：变化时重挂载（双保险）
}
```

- **受控语义（关键）**：原子编辑器非受控，切笔记靠 **`ContentArea` 给 `NoteView` 加
  `key={activeNoteId}`** 强制重挂载——draft 初始值即新笔记 content，编辑器读正确初始值。
  NoteView 的「重置 draft 的 useEffect」已删除（重挂载接管）。
- 自组 EditorView（而非 `AtomicCodeMirrorEditor` 组件）：组件句柄不暴露 EditorView，
  MarkdownInsertApi 的 wrap/block/jumpTo 需 dispatch 文档变更。
- 扩展顺序对齐 atomic 组件源码（`AtomicCodeMirrorEditor.tsx`），追加 placeholder /
  mathExtension / underlineExtension / Mod-s keymap。

### MarkdownInsertApi（markdownInsertApi.ts）——CM6 源码偏移命令

```ts
interface MarkdownInsertApi {
  wrap(before, after?, placeholder?): void   // 源码包裹；选中替换 before..after
  block(prefix, suffix?, opts?): void        // 行级行首插入 / 块级多行块插入
  insertImage(path: string): void            // ![alt](path)，路径 () 转义 %28/%29
  jumpTo(item: OutlineItem): void            // item.offset 定位（恢复 offset 契约）
  focus(): void
}
```

- 全部 `view.dispatch({ changes, selection })`；view 惰性获取（挂载前 null → no-op）
- block 块级：列表项内补空行退出列表；围栏内容区内插入落到围栏结束后
- jumpTo 用 `item.offset`（CM6 源码偏移直接有效，替代 Milkdown 的 level+text 匹配）

## mathExtension（$…$ / $$…$$）——自研 KaTeX 公式

File: `src/components/Editor/extensions/mathExtension.ts`

- **StateField** 提供 decoration（跨行 block widget 必须来自 StateField，非 ViewPlugin）
- 语法树驱动：只扫 `Paragraph` / `ATXHeading1..6`，剔除 `InlineCode` / `Link` / `Image`
  子树（表格非 Paragraph 天然排除）
- 语法边界：行内 `$` 非转义 + 开后非空白 + 闭前非空白 + 内容不含 `$`/换行；
  块级整行 `$$content$$`（单行）/ `$$` 起止行（多行）；先块后行内互不重叠
- 光标行揭示：selection 覆盖的行显示源码（块被覆盖任一行 → 整块源码）；只读恒渲染
- 点击渲染结果 → selection 移入公式源码（revealPos）
- KaTeX `renderToString` + 内容缓存；错误显示 `.cm-math-error`
- **block widget 不替换行尾换行**：`Decoration.replace` 范围 = [from, to)（不含换行）——
  实测 replace 含换行 → Enter 后 selection 丢失（`getSelection()` 空），后续输入窜到文档开头

## underlineExtension（<u>下划线</u>）——自研

File: `src/components/Editor/extensions/underlineDecoration.ts`

- ViewPlugin + 正则 `<u>([^<]*?)</u>`：`<u>`/`</u>` 标签 `Decoration.replace({})` 隐藏，
  内容 `Decoration.mark({ class: 'cm-underline' })`（CSS text-decoration: underline）
- 光标行揭示（selection 覆盖的行显示源码）；源码保留 `<u>` 原文

## 主题（atomicTheme.css）

- atomic-editor 通过 `--atomic-editor-*` 变量主题化；本项目在 `.atomic-cm-editor` 上
  映射项目 shadcn 语义色（`--foreground`/`--muted-foreground`/`--background`/`--border` 等），
  深浅色自动跟随 `html.dark`（不使用 atomic 的 `[data-theme="light"]` 机制）
- 自研装饰样式（`.cm-math-inline`/`.cm-math-block`/`.cm-math-error`/`.cm-underline`）同文件定义
- KaTeX 字体经 vite `katexWoff2Only` 裁剪（仅 woff2）；构建目标 chrome 88（lightningcss 降级）
- **编辑区宽度**（R1）：覆盖 atomic 的 70ch 居中——`.atomic-cm-editor .cm-content { max-width: none; margin-inline: 0; padding-inline: 0.75rem }`（占满可用宽度）
- **公式高度**（R6）：`.cm-math-block` padding `0.1em 0`（原 0.4em）

## 定制行为（patch @atomic-editor/editor 0.6.2）

> 08-14-editor-instant-render-polish：6 项优化中 3 项（列表圆点分层/缩进/引用恒隐藏）埋在
> atomic 打包代码，无配置/CSS 入口，采用 patch-package 打最小补丁（4 处）。

- **setext 标题禁用**：`AtomicEditor.tsx` 的 `markdown()` 传
  `extensions: [highlightMarkdown, { remove: ['SetextHeading'] }]`——`文本\n-`、`文本\n====`
  不再渲染成标题（标题只用 `#` ATX）；`---` 单独一行的 HorizontalRule 是独立 block parser，不受影响。
- **列表圆点分层**（patch `inline-preview.js`）：`BulletWidget` 按 `listItemDepth` 渲染
  `['•','○','▪'][depth % 3]`（depth 0 实心圆 / 1 空心圆 / 2 实心方形 / ≥3 循环）。
- **列表缩进**（patch）：`LIST_LEVEL_EM` 0.6 → 1.2（每层 +1.2em）。
- **引用 `>` 恒隐藏**（patch）：`QuoteMark` 的 `shouldHide` 恒 true（光标行也隐藏，对齐
  ListMark/TaskMarker 已恒隐藏的行为）；标题 `#`/粗体 `**` 等**仍保持光标行揭示**（Obsidian 标准，便于编辑标记）。

**patch-package 机制**：
- `@atomic-editor/editor` 锁定精确 `0.6.2`（去 `^`）；补丁在 `patches/@atomic-editor+editor+0.6.2.patch`。
- `package.json` 有 `"postinstall": "patch-package"`，`npm i`/`npm ci` 后自动重放补丁（幂等）。
- **升级 atomic 需重打补丁**：改 node_modules 后 `npx patch-package @atomic-editor/editor`；
  npm 12 下生成补丁时需 `$env:npm_config_allow_remote="all"`（EALLOWREMOTE，仅生成时，应用时无需）。
- **dev 缓存坑**：改 node_modules 后若 dev server 早已启动，`node_modules/.vite` 依赖预构建
  缓存仍是旧代码——删 `.vite` 重启 dev server 才生效（生产构建 dist 不受影响）。

## 已知限制（测试与渲染相关）

- **CM6 虚拟化渲染**：`.cm-line` 仅可视行，长文档测试不能断言全量 DOM 行数（旧 ProseMirror
  全量渲染的 `liCount >= 500` 断言不适用）——断言源码行数 `getContent().split('\n').length`
- **atomic 非光标行隐藏转义符**：`\$` 的 `\` 在渲染 DOM 里被隐藏（显示 `$`），源码保留 `\$`——
  边界断言走 store 源码，不能走 `.cm-content` textContent（且 textContent 无换行符）
- **CM6 markdown 续行**：`> `/`- `/`1. ` 后 Enter 自动续行标记（`insertNewlineContinueMarkup`），
  测试退出引用/列表用 Backspace 删除续行标记；长文档 insertText 勿带 `- ` 前缀（会叠加嵌套）
- **光标行揭示**：autoFocus 光标在首行 → 首行公式不渲染；重开断言前先 `Control+End` 跳末尾
- **block widget**：替换范围严禁含换行符（见 mathExtension 备注）

## 体积

- dist 解压 1.68 MB（JS 1.02MB + CSS 146KB + KaTeX 字体 ~260KB），≤ 5MB（AC13）
