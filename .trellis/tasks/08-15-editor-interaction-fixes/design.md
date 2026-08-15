# 技术设计：编辑器交互与样式修复

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/components/Editor/AtomicEditor.tsx` | R1 Backspace handler、R6 状态回调 prop |
| `src/components/Editor/extensions/underlineDecoration.ts` | R3 光标 reveal 标签 |
| `src/components/Editor/extensions/mathExtension.ts` | R5 点击校验 + 间距（minHeight 策略） |
| `src/components/Editor/atomicTheme.css` | R2 高亮色、R4 标题字号间距、R5 块样式 |
| `src/components/Editor/MarkdownToolbar.tsx` | R6 按钮 active 高亮 |
| `src/components/NoteView.tsx` | R6 状态传递 |
| `.trellis/spec/frontend/`（如适用） | 迭代后 spec 更新 |

## D1 R1 引用删除键（Backspace 兜底）

**问题**：`deleteMarkupBackward`（lang-markdown）依赖 `syntaxTree(state)` 中光标行的 Blockquote 上下文；长文档/树未解析到光标行时可能返回 false → 退化为逐字符删除（`>` 和空格需两次按键）。且一次按键只删一个"空格或标记"的分支行为不确定。

**方案**：新增 `exitBlockquoteOnBackspace(view)`，与现有 `exitBlockquoteOnEnter` 对称，注册于同一个 `Prec.high(keymap.of([...]))`（Enter 之后）：

```ts
function exitBlockquoteOnBackspace(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.from)
  if (sel.from !== line.to) return false          // 仅行尾
  const m = /^(\s*)(>)\s*$/.exec(line.text)        // 空引用行（> / > ）
  if (!m) return false
  const from = line.from + m[1].length
  view.dispatch({
    changes: { from, to: line.to, insert: '' },
    selection: EditorSelection.cursor(from),
  })
  return true
}
```

- 仅在「行文本恰为 `>` 或 `> ` 且光标行尾」时介入；其余交给 `deleteMarkupBackward`/默认 Backspace
- 嵌套引用（`> > `）不匹配 regex → 不干预（保留 lang-markdown 行为）
- `Prec.high` 保证先于普通 keymap 的 Backspace

## D2 R2 高亮黄色渲染

**问题**：`.cm-atomic-highlight { background: color-mix(in srgb, var(--atomic-editor-accent-bright) 20%, transparent 80%) }`，而项目 `--atomic-editor-accent-bright: var(--foreground)`（黑白）→ 20% 混合后几乎不可见。

**方案**（两个改动，作用叠加）：
1. `atomicTheme.css` 增补项目级高亮 token：`--atomic-editor-highlight: <黄色>`，浅色 `#fde047`（yellow-300 系）深色 `#a16207`（yellow-700 系）——沿用现有「变量映射 shadcn 语义色」模式，深色由 `html.dark` 驱动（可在 `.dark .atomic-cm-editor` 下覆盖）
2. `atomicTheme.css` 覆盖渲染色：
   ```css
   .cm-atomic-highlight {
     background: color-mix(in srgb, var(--atomic-editor-highlight, #fde047) 45%, transparent 55%);
   }
   ```
   45% 透明度使黄底清晰但不刺眼；`color` 保留 foreground 保证对比度。

验收基准：computed background 含明显黄色（R>0.7, G>0.5, B<0.4 量级），浅/深色均成立。

## D3 R3 下划线标签 reveal

**现状**：`buildUnderlineDecorations` 对所有 `<u>`/`</u>` 做 `Decoration.replace({})` 恒隐藏。

**方案**：`buildUnderlineDecorations(view)` 已持有 view；计算「光标相关区间」：
- 取 `state.selection.main` 的 from/to（含跨行选择），对每个 `UNDERLINE_RE` 匹配区间 `[uFrom, uTo)`：
  - 若 `sel.from < uTo && sel.to > uFrom`（光标/选区触及该区间）→ **不 replace 标签**（标签以源码显示）
  - 否则 → replace 隐藏（现状）
- `Decoration.mark({ class: 'cm-underline' })` 内容样式不变（光标行也保留下划线）
- 光标移出 → `selectionSet` 触发 rebuild → 恢复隐藏

```ts
const sel = view.state.selection.main
// 循环内：
const active = sel.from < to && sel.to > from
if (!active) {
  builder.add(from, contentFrom, Decoration.replace({}))
  builder.add(contentTo, to, Decoration.replace({}))
}
builder.add(contentFrom, contentTo, Decoration.mark({ class: 'cm-underline' }))
```

边界：光标恰在 `<u>` 与内容之间（`from < head < contentFrom`）→ `sel.from < to` 成立 → 显示标签（可编辑）；选区跨多个区间 → 全部显示。

## D4 R4 标题字号与分割线间距

**现状**：`atomicTheme.css` 只覆盖 font-size（h1 1.45em…），line-height/padding 沿用 atomic 默认（1.3 / 0.15em+0.1em）；分割线 `::after` 贴行底 → 与下一行 0 间距。

**方案**（在 atomicTheme.css 中一并覆盖，保持「line-height 比例 + padding 量级」模式，避免破坏 CM6 块行测量）：

```css
.cm-line.cm-atomic-h1 { font-size: 1.7em;  line-height: 1.28; padding-top: 0.28em; padding-bottom: 0.3em; }
.cm-line.cm-atomic-h2 { font-size: 1.45em; line-height: 1.32; padding-top: 0.26em; padding-bottom: 0.26em; }
.cm-line.cm-atomic-h3 { font-size: 1.25em; line-height: 1.36; padding-top: 0.24em; padding-bottom: 0.22em; }
.cm-line.cm-atomic-h4 { font-size: 1.1em;  line-height: 1.4;  padding-top: 0.2em;  padding-bottom: 0.18em; }
.cm-line.cm-atomic-h5 { font-size: 1.02em; line-height: 1.42; }
.cm-line.cm-atomic-h6 { font-size: 0.95em; line-height: 1.42; }
```

- `padding-bottom` 扩大 → 分割线（`bottom: 0`）与下一行正文间距 = padding-bottom ≈ 0.3em ✓
- `padding-top` 扩大 → 标题与上文间距增大 ✓
- 分割线 `::after` 保留（border-bottom 1px）
- 行高总量：h1 = 1.7×1.28 + 0.58 ≈ 2.76em 视觉高度；CM6 会测量 block line 实际高度（heading 行由 `Decoration.line` 提供，atomic 已用同模式），滚动/点击不回归由 smoke + 手工验证

## D5 R5 公式块：间距统一 + 点击修复

### D5.1 点击错位修复（必做）

**根因**：块 widget DOM 高度 = KaTeX 内容高度（可远超 1 行，如 `\sum` 69px vs 行高 28.9px），溢出区域仍属于该 widget DOM → 点击「第一块下方空白/第二块顶部」命中第一块 DOM → 错误 reveal 第一块。

**方案**：`MathWidget.toDOM` 的 mousedown handler 中，用 CM6 坐标映射校验点击归属：

```ts
dom.addEventListener('mousedown', (e) => {
  const view = EditorView.findFromDOM(dom)
  if (!view || view.state.readOnly) return
  const hit = view.posAtCoords({ x: e.clientX, y: e.clientY })
  // 点击位置不在本块源码区间内（溢出区域/其他块）→ 不拦截，交 CM6 默认定位
  if (hit === null || hit < this.from || hit > this.to) return
  e.preventDefault()
  view.dispatch({ selection: { anchor: this.revealPos }, effects: EditorView.scrollIntoView(this.revealPos) })
  view.focus()
})
```

- `MathWidget` 构造增加 `from`/`to` 参数（来自 MathRange）
- `posAtCoords` 基于 CM6 的测量后 heightmap：点击第二块视觉区 → 返回第二块内位置 → 第二块 handler 生效；点击第一块溢出区 → 返回第二块位置（不在第一块区间）→ 第一块不拦截 → CM6 默认把光标放进第二块 → 第二块 reveal ✓

### D5.2 间距统一（实验驱动，二选一）

**方案 A（首选）移除 minHeight，依赖 CM6 块测量**：
- CM6 `HeightMapBlock.setMeasuredHeight` 会测量 block widget 实际 DOM 高度并更新 heightmap（@codemirror/view 6.43.8 确认存在）
- 移除 `lineCount`/`minHeight` 逻辑 → widget DOM 高 = KaTeX 内容 + 统一 padding/margin → 所有块视觉高度由内容决定，**间距与源码行数无关** ✓（满足 PRD R5 间距）
- **验证点**（实验后必测）：
  - 多行块渲染态 1 行高时：块后 Enter/方向键/点击/滚动定位正确（原注释称「吸到块起点」——需要验证该结论在新版本 CM6 是否仍成立）
  - 渲染↔reveal 切换（高度 1 行 ↔ 3 行源码）不产生视口跳动/光标丢失
  - 失败（出现错位）→ 回退方案 B

**方案 B（兜底）保留 minHeight + 视觉统一**：
- 保留 `minHeight = lineCount 行`（heightmap 与 DOM 一致，布局稳定）
- `.cm-math-block` 改 flex 容器，KaTeX 内容垂直居中；padding 统一（如 `0.35em 0`）+ `katex-display` margin 归零，用块 padding 统一间距
- 间距 = max(剩余行空白, padding) 视觉一致性优于现状，但多行块仍高于单行块（接受折中）

### D5.3 样式统一（两方案共用）

```css
.cm-math-block {
  display: block;
  text-align: center;
  padding: 0.35em 0;                    /* 统一块内上下留白 */
}
.cm-math-block .katex-display { margin: 0; }   /* 取消 KaTeX 自带 margin，间距由 padding 统一 */
```

## D6 R6 工具栏联动

### D6.1 状态计算（编辑器侧）

新增 prop（向后兼容，可选）：

```ts
interface AtomicEditorProps {
  // ...
  /** selection 变化时上报光标处格式状态（undefined 时不上报，默认不开启） */
  onActiveFormat?: (fmt: ActiveFormatState) => void
}

export interface ActiveFormatState {
  heading: 1 | 2 | 3 | 0          // 0 = 非标题
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  highlight: boolean
  inlineCode: boolean
  link: boolean
  quote: boolean
  ul: boolean
  ol: boolean
  task: boolean
}
```

**计算**（`view.updateListener` 中 `selectionSet || docChanged` 时调用，防抖/节流可选）：
- 语法树（`ensureSyntaxTree`）：`resolveInner(head, 1)` 向上遍历父节点：
  - `ATXHeading1..6` → heading 级别
  - `StrongEmphasis` / `Emphasis` / `Strikethrough` / `InlineCode` / `Link` → 对应布尔
  - `Blockquote` 祖先 → quote；`ListItem` 祖先 → 按行文本判定 ul/ol/task
- 正则（非语法树覆盖）：光标所在行/区间 `<u>…</u>`（UNDERLINE_RE 复用）
- 选区跨多格式时：光标 head 位置判定即可（简单一致）

### D6.2 传递与渲染（UI 侧）

- `NoteView`：维护 `const [fmt, setFmt] = useState<ActiveFormatState>(EMPTY_FMT)`；`<AtomicEditor onActiveFormat={setFmt} … />`；`<MarkdownToolbar api={…} activeFormat={fmt} />`
- `MarkdownToolbar`：`TOOLS` 增加 `match(fmt): boolean` 判定（h1/h2/h3、bold、italic、underline、strike、highlight、inline-code、link、quote、ul、ol、task 共 13 项）；匹配时按钮加高亮样式：
  ```tsx
  className={cn(active && 'bg-accent text-destructive hover:text-destructive')}
  ```
  用户要求「红色」→ 用 `text-destructive`（项目 destructive 语义色）确保深浅色可见
- 只读模式无工具栏（现状天然满足）

### D6.3 边界
- 空选区（光标）与有选区统一按 head 判定
- 编辑器卸载/切笔记时 fmt 复位（NoteView 由 key remount，state 随组件销毁自然复位；或 effect 清理时置空）

## D7 回归与验证策略

- 每项修复后跑针对性 Playwright 验证脚本（临时文件 `verify-*.tmp.mjs`，验收后删除）
- 全部完成后跑 `npm run smoke:editor`（32 项）+ `npm run typecheck`
- 手工验证清单（浏览器）：长文档空引用行 Backspace、深浅色高亮、标题滚动定位、相邻公式块点击、工具栏联动
