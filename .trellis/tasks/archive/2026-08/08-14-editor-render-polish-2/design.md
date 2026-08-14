# 设计：编辑器渲染二次打磨

## 1. 方案总览

| 需求 | 实现层 | 文件 | 是否动 node_modules |
|---|---|---|---|
| R1 引用换行退出 | 自研 Enter keymap | `AtomicEditor.tsx` | 否 |
| R2 列表圆点加深加大 | CSS 覆盖 | `atomicTheme.css` | 否 |
| R3 公式间距 + 点击 | CSS 覆盖（+ 验证） | `atomicTheme.css` | 否（必要时 `mathExtension.ts`） |
| R4 链接蓝色 | CSS 变量 | `atomicTheme.css` | 否 |
| R5 标题字号 + 细线 | CSS 覆盖 | `atomicTheme.css` | 否 |
| R6 下划线恒渲染 | 去掉光标行揭示 | `underlineDecoration.ts` | 否 |
| R7 内联格式快捷键 + toggle | toggle API + keymap + 工具栏 | `markdownInsertApi.ts` / `AtomicEditor.tsx` / `MarkdownToolbar.tsx` | 否 |

本次**全部为视图层改动**，不引入新 patch（上一任务的 `patches/@atomic-editor+editor+0.6.2.patch` 保持不变）。`atomicTheme.css` 在 `AtomicEditor.tsx` 中于 `@atomic-editor/editor/styles.css` 之后 import，同 specificity 下后加载者胜，可直接覆盖 atomic 的 `.cm-line.cm-atomic-*` 与 `.cm-atomic-bullet` 等规则。

## 2. R1：引用块 Enter 退出（自研 keymap）

### 现状与目标

- `markdownKeymap`（AtomicEditor.tsx:174）的 `insertNewlineContinueMarkup` 对 blockquote：非空引用行 Enter 续 `> `（符合期望）；空引用行 Enter 仅在「上一行也是空引用行」时退出（index.js:250-258），即实际 Enter 三次才退。
- 目标：非空引用行 Enter 续 `> `（保持）；**空引用行行尾 Enter 立即退出**（Obsidian 标准）。

### 实现

在 `AtomicEditor.tsx` 新增一个 `Prec.high` keymap，命令逻辑：

```ts
function exitBlockquoteOnEnter(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.from)
  if (sel.from !== line.to) return false          // 仅光标在行尾
  const m = /^(\s*)(>)\s*$/.exec(line.text)        // 纯空引用行：前导空白 + `>` + 尾空白
  if (!m) return false
  const from = line.from + m[1].length
  view.dispatch({
    changes: { from, to: line.to, insert: '' },   // 删除 `>` 及尾空白
    selection: EditorSelection.cursor(from),
  })
  return true
}
```

- 注册：`Prec.high(keymap.of([{ key: 'Enter', run: exitBlockquoteOnEnter }]))`，放在现有 `Prec.high(Mod-s)` 之后、`markdownKeymap` 之前（keymap 同优先级按注册顺序，先注册者先匹配）。
- 返回 `false` 时 fallthrough 到 `markdownKeymap` 的 `insertNewlineContinueMarkup`（继续引用 / 列表续行不受影响）。
- 边界：只匹配「整行是空引用」（`> ` 或 `>`），非空引用行（`> 文字`）不触发；多级引用（`> > `）不匹配（正则要求单 `>`）；仅删当前行的 `>`，不删上一行（与 lang-markdown 的「删两行」语义不同，更贴合 Obsidian 单行退出）。

### trade-off

- 自研 keymap（~15 行）vs patch lang-markdown 退出条件：自研零 patch、可独立回滚，代价是复制了很小一段退出语义。选自研。
- 多级引用 `> > x` 空行退出一级（用户后续如需可扩展）；本次范围只覆盖单层引用（用户场景）。

## 3. R2：列表圆点加深加大

### 现状

- `.cm-atomic-list-marker`（inline-preview.css:342-347）：`display: inline-block; width: 0.9em; margin-right: 0.3em; text-align: right`（固定 alcove，供 bullet/checkbox/ordered 对齐）。
- `.cm-atomic-bullet`（350-353）：`color: var(--atomic-editor-fg-muted); font-weight: 700`。

### 首选方案（纯 CSS，不动布局盒）

在 `atomicTheme.css` 追加：

```css
.cm-atomic-bullet {
  color: var(--foreground);
  transform: scale(1.3);
  transform-origin: center;
}
```

- `color: foreground` 加深（`•`/`▪` 形状差异随颜色加深而清晰）。
- `transform: scale(1.3)` 视觉放大**不改变布局盒**（`.cm-atomic-list-marker` 的 `width: 0.9em` 与 `LIST_ALCOVE_EM` 缩进对齐不受扰动；`font-size` 会因 em 相对自身而连带放大 alcove，破坏对齐，故不用）。

### fallback（若 scale 视觉溢出或用户嫌第二层也放大）

- patch `inline-preview.js` 的 `BulletWidget`：`toDOM` 追加 depth class（如 `cm-atomic-bullet-solid`/`cm-atomic-bullet-hollow`），CSS 按 class 精确控制第一/三层 font-size + 颜色，第二层保持 muted。仅当纯 CSS 不满足时启用（需重打 patch + 更新 `patches/`）。

### 验证要点

- `transform: scale` 右对齐下字符中心缩放，可能向 alcove 左侧空白溢出、向右进入 margin-right 0.3em 缓冲；实现时实测 `•`/`▪` 与后续文字无重叠、无换行错位。若溢出，调低 scale（1.2~1.25）。

## 4. R3：公式块间距 + 点击

### 间距（CSS 覆盖）

`atomicTheme.css` 追加：

```css
.cm-math-block .katex-display {
  margin: 0.15em 0;
}
```

覆盖 katex.min.css 的 `.katex-display { margin: 1em 0 }`。`.cm-math-block` 自身 `padding: 0.1em 0` 保持。

### 点击 bug（与间距同源，修后验证）

- margin 取消后 `.cm-math-block` 的 `getBoundingClientRect` 与 DOM 占位一致，CM6 heightmap 与 DOM 对齐，点击公式及周边可正确命中 widget DOM → 触发 `MathWidget` mousedown reveal（mathExtension.ts:94-103）。
- 多行块公式（`$$` 起止行）保留 `minHeight = calc(lineCount * leading * 1em)` 逻辑（mathExtension.ts:89-91），修 margin 后其 heightmap 对齐不受影响。
- **验证**：单行 `$$x$$` 上下有文字时点击进入编辑、方向键上下移动定位准确；多行块同理。若修 margin 后点击仍异常，进一步排查 `MathWidget.toDOM` 的 mousedown 命中与 `revealPos`（r.from + 2）定位——此时需改 `mathExtension.ts`（作为验证兜底，不预改）。

## 5. R4：链接蓝色

`atomicTheme.css` 变量映射改两行：

```css
--atomic-editor-link: #3b82f6;        /* blue-500 */
--atomic-editor-link-hover: #2563eb;  /* blue-600，hover 深一档 */
```

- 链接图标 `::after`/`.cm-atomic-link-icon` 的 `background-color: color-mix(in srgb, var(--atomic-editor-link) 82%, white 18%)` 自动跟随。
- 浅色/深色主题下 `#3b82f6` 均可辨（项目用 `html.dark` 切换，非 atomic 的 `[data-theme=light]`，无需在 light 分支另设）。

## 6. R5：标题字号 + 下细线

`atomicTheme.css` 追加（覆盖 inline-preview.css 的 `.cm-line.cm-atomic-h*`，同 specificity 后加载者胜）：

```css
.cm-line.cm-atomic-h1 { font-size: 1.45em; }
.cm-line.cm-atomic-h2 { font-size: 1.3em; }
.cm-line.cm-atomic-h3 { font-size: 1.18em; }
.cm-line.cm-atomic-h4 { font-size: 1.06em; }
.cm-line.cm-atomic-h5 { font-size: 1em; }
.cm-line.cm-atomic-h6 { font-size: 0.95em; }

.cm-line.cm-atomic-h1,
.cm-line.cm-atomic-h2,
.cm-line.cm-atomic-h3,
.cm-line.cm-atomic-h4,
.cm-line.cm-atomic-h5,
.cm-line.cm-atomic-h6 {
  position: relative;
}

.cm-line.cm-atomic-h1::after,
.cm-line.cm-atomic-h2::after,
.cm-line.cm-atomic-h3::after,
.cm-line.cm-atomic-h4::after,
.cm-line.cm-atomic-h5::after,
.cm-line.cm-atomic-h6::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  border-bottom: 1px solid var(--border);
  pointer-events: none;
}
```

- 字号 +~8%（h1 1.35→1.45、h2 1.2→1.3、h3 1.1→1.18、h4 1→1.06、h5 0.95→1、h6 0.9→0.95），不重写 line-height/font-weight（沿用 atomic）。
- 细线用 `::after` 绝对定位（复用 `.cm-atomic-hr::after` 先例），不占布局流、不扰动 CM6 高度测量；`position: relative` 锚定标题行。

## 7. R6：下划线恒渲染

### 现状与目标

- `underlineDecoration.ts:49` 的光标行揭示 `if (lines.has(doc.lineAt(from).number)) continue` 导致光标行显示 `<u>文字</u>` 源码（标签可见、文字无下划线），与粗体 `**` 的「标记可见但内容仍加粗」不一致。
- 目标：`<u>`/`</u>` 标签在任意行恒隐藏，内容恒加下划线（对齐引用 `>` 恒隐藏契约）。

### 实现

`underlineDecoration.ts` 删除光标行揭示逻辑：

```ts
function buildUnderlineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()
  UNDERLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = UNDERLINE_RE.exec(text)) !== null) {
    const from = m.index
    const to = from + m[0].length
    const contentFrom = from + '<u>'.length
    const contentTo = to - '</u>'.length
    builder.add(from, contentFrom, Decoration.replace({}))
    builder.add(contentFrom, contentTo, Decoration.mark({ class: 'cm-underline' }))
    builder.add(contentTo, to, Decoration.replace({}))
  }
  return builder.finish()
}
```

- 删除 `lines` 计算与 `if (lines.has(...)) continue`；`update()` 的 `viewportChanged` 也可保留（无副作用）。
- 空标签 `<u></u>`（contentFrom === contentTo）：两端 `replace` 仍生效隐藏标签，中间空 mark 无效 → 视觉上标签消失、光标居中可输入。

### trade-off

- 恒隐藏后用户看不到 `<u>`/`</u>` 标签，删除下划线无法通过直接删除标签完成，只能退格删除或全选重设。这是与引用 `>` 恒隐藏相同的取舍；下划线为低频格式，用户优先要「正常渲染」。
- 与 `spec/frontend/editor.md` 现有「光标行揭示」契约冲突的部分（下划线）需在 Phase 3 更新。

## 8. R7：内联格式快捷键 + toggle

### 现状与目标

- 工具栏 bold/italic/underline 仅 `wrap`（重复触发嵌套）；无 Ctrl+B/I/U 快捷键。
- 目标：Ctrl+B/I/U 与工具栏按钮均支持 toggle（完成/取消），语义统一。

### toggle 语义（`MarkdownInsertApi.toggleInline`）

新增 `toggleInline(open: string, close = open, nodeName?: string): void`：

1. **有选中**：字符串前后缀判断 `sliceDoc(from-open.len, from) === open && sliceDoc(to, to+close.len) === close`——包裹则取消（删除两端标记），否则包裹（`open + sel + close`）。
2. **无选中**：
   - `nodeName` 存在（加粗 `StrongEmphasis` / 斜体 `Emphasis`）：`syntaxTree` 上溯找节点，命中则取消（删节点两端标记，光标落内容起点）。
   - `nodeName` 缺失（下划线 `<u>`/`</u>`）：正则 `<u>([^<]*?)</u>` 找光标所在包裹对，命中则取消（删 `<u>`/`</u>`）。
   - 均未命中：生成空标记 `open + close`，光标居中（`anchor: from + open.length`）。

- 调用映射：加粗 `toggleInline('**','**','StrongEmphasis')`、斜体 `toggleInline('*','*','Emphasis')`、下划线 `toggleInline('<u>','</u>')`。

### keymap（AtomicEditor.tsx）

在现有 `Prec.high(Mod-s)` 附近追加 `Prec.high` keymap：

```ts
{ key: 'Mod-b', run: () => { api.toggleInline('**', '**', 'StrongEmphasis'); return true } },
{ key: 'Mod-i', run: () => { api.toggleInline('*', '*', 'Emphasis'); return true } },
{ key: 'Mod-u', run: () => { api.toggleInline('<u>', '</u>'); return true } },
```

- `Mod-b/i/u`（Windows = Ctrl，跨平台 = Cmd），`return true` 阻止浏览器默认（Ctrl+B/I/U 的 contenteditable 加粗/斜体/下划线行为）。
- `api` 为 `useMemo([], ...)` 稳定闭包，keymap 命令可直接引用；`toggleInline` 内部经 `getView()` 惰性取 view（挂载前 no-op）。

### 工具栏（MarkdownToolbar.tsx）

bold/italic/underline 三个工具 `run` 从 `wrap(...)` 改为 `api.toggleInline(...)`（与快捷键同语义，避免重复触发嵌套）。

### trade-off

- 加粗/斜体用语法树定位「无选中取消」最准（嵌套 `**粗*斜*粗**` 也正确）；下划线是 HTML 标签无对应 lezer 节点，用正则找包裹对（`[^<]*` 内容不含 `<`，嵌套下划线不支持——可接受）。
- 范围限定加粗/斜体/下划线三项；高亮 `==`、删除线 `~~`、内联代码 `` ` ``、公式 `$` 不新增快捷键（超出本次）。

## 9. 数据流与契约

- 全部视图层 + 编辑命令：CSS 覆盖 + keymap/装饰改动（R1 删 `>` 是合法编辑；R6 恒隐藏是纯视图；R7 toggle 是合法编辑——加/删标记字符，符合 round-trip 契约，源码始终是合法 Markdown）。
- round-trip 字节级一致契约保持：R2/R3/R4/R5/R6 纯装饰/CSS 不改内容；R1/R7 是编辑行为，产生合法源码。
- `MarkdownInsertApi` **新增** `toggleInline` 方法（追加，不破坏现有 `wrap`/`block`/`insertImage`/`jumpTo`/`focus` 契约）；`NoteView`/`MetaInfoPanel` 零改动；`MarkdownToolbar` 仅改 3 个工具 run 实现（props/布局不变）。

## 10. 兼容性与风险

- **R1/R7 keymap 与 `insertTightListItem`（atomic Prec.highest）共存**：`exitBlockquoteOnEnter` 只匹配纯空引用行；`Mod-b/i/u` 与 markdownKeymap（仅 Enter/Backspace）无键位冲突，与 defaultKeymap（无 Mod-b/i/u）无冲突。
- **R2 scale 溢出**：若视觉溢出调低 scale，或启用 fallback patch（见 §3）。
- **R3 点击未修复**：若修 margin 后点击仍异常，回退到 `mathExtension.ts` 排查（见 §4），仍不改上游。
- **R6 删除下划线不便**：由 R7 toggle 解决（工具栏/快捷键完成/取消，无需手动删标签）。
- **R7 无选中取消的边界**：光标在格式边界（如 `**` 前一个字符）时语法树可能判为「格式外」而生成空标记——实现时用 `resolveInner(from, 1)` 取含光标的最小节点，验证边界行为，必要时用 `-1` 侧调整。
- **回滚**：全部改动在 `atomicTheme.css` + `AtomicEditor.tsx` + `underlineDecoration.ts` + `markdownInsertApi.ts` + `MarkdownToolbar.tsx` 五个项目文件内，`git checkout` 即整体回退；无需删 patches / 重装依赖。

## 11. Spec 更新点（Phase 3）

- `spec/frontend/editor.md`：追加 R1 引用 Enter 退出语义（覆盖「CM6 markdown 续行」旧说明）、R2 圆点样式、R3 KaTeX margin 覆盖、R4 链接蓝色变量、R5 标题字号/细线、R6 下划线恒隐藏（修正「光标行揭示」中下划线的例外）、R7 toggle API + 快捷键（MarkdownInsertApi 契约新增 `toggleInline`）。
