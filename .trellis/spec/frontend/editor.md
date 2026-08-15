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
  onActiveFormat?(fmt: ActiveFormatState): void  // selection/doc 变化上报光标格式（工具栏联动；缺省不上报）
  placeholder?: string     // @codemirror/view placeholder 扩展
  autoFocus?: boolean
  readonly?: boolean       // readOnlyExtension（Compartment reconfigure）
  className?: string
  documentId: string       // 文档身份：变化时重挂载（双保险）
}
```

- **ActiveFormatState**（R6 工具栏联动）：`heading: 0|1..6` + bold/italic/underline/
  strike/highlight/inlineCode/link/quote/ul/ol/task 布尔。由 `computeActiveFormat`
  计算：语法树（resolveInner 沿父链收集 ATXHeading/StrongEmphasis/Emphasis/
  Strikethrough/InlineCode/Link/Highlight/Blockquote/ListItem）+ 正则（`<u>` 区间
  复用 UNDERLINE_RE）；长文档光标行未解析时尽力而为。回调经 ref 同步（不重建
  updateListener）。MarkdownToolbar 消费：匹配的按钮 `text-destructive` + `bg-accent`
  红色高亮。

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
  toggleInline(open, close?, nodeName?): void // 内联格式 toggle（完成/取消）
  focus(): void
}
```

- 全部 `view.dispatch({ changes, selection })`；view 惰性获取（挂载前 null → no-op）
- block 块级：列表项内补空行退出列表；围栏内容区内插入落到围栏结束后
- jumpTo 用 `item.offset`（CM6 源码偏移直接有效，替代 Milkdown 的 level+text 匹配）
- **toggleInline（R7）**：加粗 `('**','**','StrongEmphasis')` / 斜体 `('*','*','Emphasis')` /
  下划线 `('<u>','</u>')`。有选中→前后缀判断包裹/取消；无选中→加粗/斜体走语法树上溯
  取消、下划线走正则 `<u>([^<]*?)</u>` 找包裹对取消、均未命中生成空标记光标居中。
  工具栏 bold/italic/underline 与快捷键 Ctrl+B/I/U（`Mod-b/i/u`）共用此方法，避免嵌套包裹。

## mathExtension（$…$ / $$…$$）——自研 KaTeX 公式

File: `src/components/Editor/extensions/mathExtension.ts`

- **StateField** 提供 decoration（跨行 block widget 必须来自 StateField，非 ViewPlugin）
- 语法树驱动：只扫 `Paragraph` / `ATXHeading1..6`，剔除 `InlineCode` / `Link` / `Image`
  子树（表格非 Paragraph 天然排除）
- 语法边界：行内 `$` 非转义 + 开后非空白 + 闭前非空白 + 内容不含 `$`/换行；
  块级整行 `$$content$$`（单行）/ `$$` 起止行（多行）；先块后行内互不重叠
- 光标行揭示：selection 覆盖的行显示源码（块被覆盖任一行 → 整块源码）；只读恒渲染
- 点击渲染结果 → selection 移入公式源码（revealPos）；**点击归属校验（R5）**：handler 用
  `view.posAtCoords({x,y})` 反查点击位置的文档归属，不在本块源码区间则不拦截（交 CM6
  默认定位）——KaTeX 内容可能高于 CM6 分配的块高（如 `\sum`/`\frac` 渲染 ~2.5 行），
  DOM 溢出区域仍属于本 widget，不校验会错误 reveal 上方块（相邻块点击错位）
- **块高不由源码行数决定（R5）**：不再按 `lineCount` 设 minHeight——CM6 会测量 block
  widget 实际 DOM 高度（`HeightMapBlock.setMeasuredHeight`）并更新 heightmap，
  多行块渲染 1 行高时点击/方向键/Enter/滚动均正常（早期「必须 minHeight 对齐 N 行」
  结论过时）；间距统一由 `.cm-math-block` padding 承担
- KaTeX `renderToString` + 内容缓存；错误显示 `.cm-math-error`
- **block widget 不替换行尾换行**：`Decoration.replace` 范围 = [from, to)（不含换行）——
  实测 replace 含换行 → Enter 后 selection 丢失（`getSelection()` 空），后续输入窜到文档开头

## underlineExtension（<u>下划线</u>）——自研

File: `src/components/Editor/extensions/underlineDecoration.ts`

- ViewPlugin + 正则 `<u>([^<]*?)</u>`：`<u>`/`</u>` 标签 `Decoration.replace({})` 隐藏，
  内容 `Decoration.mark({ class: 'cm-underline' })`（CSS text-decoration: underline）
- **标签按光标 reveal（R3）**：光标/选区触及该 `<u>…</u>` 区间（含标签字符本身）时
  标签显示为源码（可编辑）；移出恢复隐藏；只读模式恒隐藏。早期「恒隐藏」让用户
  无法看到光标所在标签、无法定位删除
- 删除下划线靠 `toggleInline('<u>','</u>')`（工具栏/快捷键），不手动删标签
- `UNDERLINE_RE` 从本文件导出，供 `markdownInsertApi.ts` 的 toggle 复用（避免重复定义）
- **RangeSetBuilder 必须按 from 递增 add**：标签/内容/闭合标签三段装饰需按文档序
  add；条件跳过（active 时不 add 标签段）不影响单调性——曾因 7,10 先于 3,7 add
  导致构建异常、整个装饰静默失效（页面无报错，下划线样式消失）

## 主题（atomicTheme.css）

- atomic-editor 通过 `--atomic-editor-*` 变量主题化；本项目在 `.atomic-cm-editor` 上
  映射项目 shadcn 语义色（`--foreground`/`--muted-foreground`/`--background`/`--border` 等），
  深浅色自动跟随 `html.dark`（不使用 atomic 的 `[data-theme="light"]` 机制）
- 自研装饰样式（`.cm-math-inline`/`.cm-math-block`/`.cm-math-error`/`.cm-underline`）同文件定义
- KaTeX 字体经 vite `katexWoff2Only` 裁剪（仅 woff2）；构建目标 chrome 88（lightningcss 降级）
- **编辑区宽度**（R1）：覆盖 atomic 的 70ch 居中——`.atomic-cm-editor .cm-content { max-width: none; margin-inline: 0; padding-inline: 0.75rem }`（占满可用宽度）
- **公式高度与间距**（R5）：`.cm-math-block` padding `0.35em 0`；`.katex-display`
  margin 归零——块与上/下内容、块与块的间距统一（由块 padding 承担），与源码
  行数解耦（多行块渲染 1 行高）
- **高亮底色**（==高亮==）：`--editor-highlight` token（index.css `:root` 浅色
  `#fde047` / `.dark` 深色 `#ca8a04`），`.cm-atomic-highlight` 覆盖为 45% 混合
  （atomic 默认 `--atomic-editor-accent-bright` 20% 混合在黑白主题下近不可见）。
  **⚠️ 勿改 `--atomic-editor-accent-bright` 为彩色**：该变量同时被光标
  （`.cm-cursor` / caretColor）使用，改色会导致光标变色；彩色样式直接引用独立 token。
- **标题字号 + 细线**（R5 迭代）：`.cm-line.cm-atomic-h1..h6` font-size 覆盖
  （1.7/1.45/1.25/1.1/1.02/0.95em）+ 上下 padding 扩大（h1 `0.28em/0.55em` 起）
  + `::after` 绝对定位 `border-bottom: 1px solid var(--border)` 细线置于 padding 区
  内（`bottom` 按级别 0.35em→0.2em，与标题文字、与下一行各留 ~0.2em）——
  绝对定位不扰动 CM6 高度测量。
- **链接蓝色**（R4）：`--atomic-editor-link: #3b82f6`、`--atomic-editor-link-hover: #2563eb`
  （原 `var(--foreground)` 黑/白）；链接图标 `::after` 的 `color-mix(link 82%)` 自动跟随。
- **列表圆点加深加大**（R2）：`.cm-atomic-bullet { color: var(--foreground); transform: scale(1.3); transform-origin: center }`
  ——用 `transform: scale` 而非 `font-size`（后者因 em 相对自身会连带放大 `.cm-atomic-list-marker`
  的 0.9em alcove，破坏缩进对齐）。`•`（depth0）/`▪`（depth2）加深后圆/方可辨。
- **公式块间距**（R3→R5）：`.cm-math-block .katex-display { margin: 0 }` 覆盖 KaTeX
  displayMode 默认 `margin: 1em 0`（间距大 + 点击不可达的同源根因——margin 不在
  `getBoundingClientRect` 内，CM6 block widget 高度测量与 DOM 错位）。块间距由
  `.cm-math-block` 自身 padding `0.35em 0` 统一承担（相邻块 padding 叠加 0.7em，
  与文字↔块 0.35em 存在差异，视觉可接受）。
- **标题字号 + 细线**（R5）：`.cm-line.cm-atomic-h1..h6` font-size 覆盖（1.45/1.3/1.18/1.06/1/0.95em，
  较 atomic 默认 +~8%）+ `::after` 绝对定位 `border-bottom: 1px solid var(--border)` 底部细线
  （复用 `.cm-atomic-hr::after` 先例，绝对定位不扰动 CM6 高度测量）。

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
  ListMark/TaskMarker 已恒隐藏的行为）；标题 `#`/粗体 `**` 等**仍保持光标行揭示**（Obsidian 标准，便于编辑标记），下划线 `<u>` 亦恒隐藏（见 underlineExtension）。

## 自研 Enter/快捷键 keymap（AtomicEditor.tsx）

- **引用 Enter/Backspace 退出（R1）**：自研 `exitBlockquoteOnEnter` / `exitBlockquoteOnBackspace`
  （**`Prec.highest`** keymap）——纯空引用行（行文本恰为 `>` / `> `）Enter 或 Backspace
  删除标记退出引用。lang-markdown 的 `insertNewlineContinueMarkup` 需「连续两行空引用」
  才退出（实际 Enter 三次），本项目改为 Obsidian 标准（非空引用行 Enter 续 `> `、空引用行
  Enter/Backspace 退出）。返回 false 时 fallthrough 到 markdownKeymap，列表续行不受影响。
- **⚠️ 必须 `Prec.highest` 而非 `Prec.high`**：lang-markdown 的 markdownKeymap 也是
  `Prec.high(keymap.of(...))` 且配置位置更早——同优先级按配置顺序，insertNewlineContinueMarkup
  会先消费 Enter（空引用行也返回 true 续行），`Prec.high` 的兜底 handler 永远轮不到
  （实测：仅 Mod 快捷键生效、Enter 静默失效，无任何报错）。
- **光标判定用「光标在 `>` 标记之后」**而非「恰为行尾」：insertNewlineContinueMarkup 续行后
  光标停在 `>` 与尾随空格之间（`>| `），行尾判定会漏。
- **事务层兜底（`exitBlockquoteOnEnterTxn`，Prec.highest transactionFilter）**：keydown
  可能被 IME（keyCode 229，输入法确认候选）吞掉，Enter 退化为默认换行（DOM change 插入
  单字符 `\n`）——在事务层拦截「光标位于空引用行 + 单字符 `\n` 插入」→ 改写为「剥离
  `> ` + 换行」。严格条件（selection 在插入点、单字符 \n、无其他 change、排除 undo/redo/
  paste）保证不误伤；keymap 正常时事务不含裸 `\n`，互不干扰。
- **快捷键（R7）**：`Mod-b`/`Mod-i`/`Mod-u`（同一 `Prec.highest` keymap，`return true` 阻断
  浏览器默认）调 `api.toggleInline(...)`；`api` useMemo 提前到 useEffect 之前（keymap 装配时
  引用，view 惰性获取）。`Mod-s` 保存同组。
- 嵌套引用（`> > `）不匹配空引用行正则 → 不干预（保留 lang-markdown 行为）。

**patch-package 机制**：
- `@atomic-editor/editor` 锁定精确 `0.6.2`（去 `^`）；补丁在 `patches/@atomic-editor+editor+0.6.2.patch`。
- `@codemirror/lang-markdown` 锁定精确 `6.5.2`；补丁在 `patches/@codemirror+lang-markdown+6.5.2.patch`——
  **空引用行（`>` / `> `）Enter 直接退出引用**（在 insertNewlineContinueMarkup 的
  「连续两个空引用行」分支前插入），与项目 keymap + transactionFilter 三层保险：
  keymap（Prec.highest，src）→ 续行函数内部（patch）→ 默认换行事务（transactionFilter）。
- `package.json` 有 `"postinstall": "patch-package"`，`npm i`/`npm ci` 后自动重放补丁（幂等）。
- **升级依赖需重打补丁**：改 node_modules 后 `npx patch-package <pkg>`；
  npm 12 下生成补丁时需 `$env:npm_config_allow_remote="all"`（EALLOWREMOTE，仅生成时，应用时无需）。
- **dev 缓存坑**：改 node_modules 后若 dev server 早已启动，`node_modules/.vite` 依赖预构建
  缓存仍是旧代码——删 `.vite` 重启 dev server 才生效（生产构建 dist 不受影响）。

## 已知限制（测试与渲染相关）

- **CM6 虚拟化渲染**：`.cm-line` 仅可视行，长文档测试不能断言全量 DOM 行数（旧 ProseMirror
  全量渲染的 `liCount >= 500` 断言不适用）——断言源码行数 `getContent().split('\n').length`
- **atomic 非光标行隐藏转义符**：`\$` 的 `\` 在渲染 DOM 里被隐藏（显示 `$`），源码保留 `\$`——
  边界断言走 store 源码，不能走 `.cm-content` textContent（且 textContent 无换行符）
- **CM6 markdown 续行**：`- `/`1. ` 后 Enter 自动续行标记（`insertNewlineContinueMarkup`），
  测试退出列表用 Backspace 删除续行标记；引用 `>` 已由自研 `exitBlockquoteOnEnter` 接管（空引用行
  Enter 退出，见上），长文档 insertText 勿带 `- ` 前缀（会叠加嵌套）
- **光标行揭示**：autoFocus 光标在首行 → 首行公式不渲染；重开断言前先 `Control+End` 跳末尾
- **block widget**：替换范围严禁含换行符（见 mathExtension 备注）

## 体积

- dist 解压 1.68 MB（JS 1.02MB + CSS 146KB + KaTeX 字体 ~260KB），≤ 5MB（AC13）
