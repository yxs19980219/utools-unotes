# 编辑器渲染二次打磨（引用换行/列表标记/公式块/链接/标题）

## Goal

修复 CM6 即时渲染编辑器（atomic-editor 0.6.2 内核）的 7 项体验问题：引用块换行退出行为、列表圆点层级视觉区分、公式块点击编辑与上下间距、链接颜色、标题字号与分隔线、下划线渲染、内联格式快捷键。让即时渲染更贴合 Obsidian 式 live preview 的期望。

## 背景与已确认事实（源码定位）

### 问题 1：引用块 Enter 换行——空引用行不退出

- **用户期望**：`> 引用` 按 Enter → 继续引用（新行 `> `）；空引用行再按 Enter → 退出引用，之后输入为普通正文。
- **现状根因**：`>` 由上一任务「引用恒隐藏」（patch `inline-preview.js`，`QuoteMark` 的 `shouldHide = true`）隐藏。Enter 由 `@codemirror/lang-markdown` 的 `insertNewlineContinueMarkup` 处理（AtomicEditor.tsx:174 引入 `markdownKeymap`）。
- **关键**：`insertNewlineContinueMarkup` 的 blockquote 退出条件是「当前行为空引用行 **且上一行也是空引用行**」（`node_modules/@codemirror/lang-markdown/dist/index.js:250-258`），即实际需要 Enter 三次才退出（`> 引用` → Enter → `> ` → Enter → 又续 `> ` → Enter 才删两行 `>`）。用户看到被隐藏 `>` 的「空行」，误以为已退出，输入文字即成引用。
- **修复方向**：自研 Enter keymap（`Prec.high`，覆盖 markdownKeymap），空引用行行尾 Enter 直接删除 `>` 退出。不动 node_modules。

### 问题 2：列表圆点第一/三层（• / ▪）颜色浅、字号小，二者难区分

- 现状：`BulletWidget` 按 depth 渲染 `['•','○','▪'][depth % 3]`（patch 已有），class 均为 `cm-atomic-list-marker cm-atomic-bullet`（无 depth 区分 class）。
- 样式：`inline-preview.css:350-353` `.cm-atomic-bullet { color: var(--atomic-editor-fg-muted); font-weight: 700 }`，字号继承正文。
- 用户期望：第一层 `•`（实心圆）与第三层 `▪`（实心方）加深颜色、加大字号，使圆/方形状可辨。
- 修复方向：`atomicTheme.css` 覆盖 `.cm-atomic-bullet` 加深（foreground）+ 放大。放大需避免扰动 `.cm-atomic-list-marker` 固定 alcove 宽度（0.9em）与 `LIST_ALCOVE_EM` 缩进对齐。

### 问题 3：公式块——点击无法进入编辑 + 上下间距仍大

- 现状：`atomicTheme.css:41-45` `.cm-math-block { padding: 0.1em 0; text-align: center }`（上一任务 R6 已从 0.4em 减到 0.1em）。
- **间距根因**：KaTeX `displayMode` 渲染产物自带 `.katex-display { margin: 1em 0; text-align: center }`（`node_modules/katex/dist/katex.min.css`），上下各 1em margin，这是间距仍大的真正来源（`padding: 0.1em` 早已很小）。
- **点击 bug 根因（同源）**：margin 不在 `.cm-math-block` 的 `getBoundingClientRect` 内，CM6 block widget 高度测量（heightmap）与 DOM 实际占位错位；公式上下有文字时错位累积，点击公式上下的空白（margin）命中的不是 widget DOM，无法触发 `MathWidget.toDOM` 的 mousedown reveal（mathExtension.ts:94-103），导致「点击无法进入编辑」。
- 修复方向：`atomicTheme.css` 覆盖 `.cm-math-block .katex-display { margin: 0.15em 0 }`，同时解决间距与点击。修后验证单行/多行块公式点击 reveal 与方向键定位。

### 问题 4：链接为黑色（前景色）

- 现状：`atomicTheme.css:27-28` `--atomic-editor-link: var(--foreground)`、`--atomic-editor-link-hover: var(--muted-foreground)`。
- 用户期望：蓝色。已确认 `#3b82f6`（blue-500）。
- 修复方向：`--atomic-editor-link: #3b82f6`，`--atomic-editor-link-hover: #2563eb`（hover 深一档）。链接图标（`::after`/`.cm-atomic-link-icon` 的 mask SVG 用 `color-mix(link 82%)`）自动跟随变蓝。

### 问题 5：标题字号偏小 + 无分隔线

- 现状：`inline-preview.css:60-108` 标题字号 h1 1.35em / h2 1.2em / h3 1.1em / h4 1em / h5 0.95em / h6 0.9em，无下分隔线。
- 用户期望：各标题「稍大一点」，标题下方一条细线标识。
- 修复方向：`atomicTheme.css` 覆盖 `.cm-line.cm-atomic-h1..h6` 的 font-size（约 +8%）+ 用 `::after` 绝对定位画 `1px solid var(--border)` 底部细线（复用 `.cm-atomic-hr::after` 先例，绝对定位不扰动 CM6 高度测量）。

### 问题 6：下划线 `<u>…</u>` 只显示标签、不渲染

- 现状：`src/components/Editor/extensions/underlineDecoration.ts:49` 的「光标行揭示」——`if (lines.has(doc.lineAt(from).number)) continue`，光标所在行整行跳过装饰，显示 `<u>文字</u>` 源码（标签可见、文字无下划线）。工具栏下划线（MarkdownToolbar.tsx:84 `wrap('<u>', '</u>')`）无选中时生成空标签 `<u></u>`，光标居中在标签内 → 用户看到 `<u></u>` 标签，输入后仍见 `<u>文字</u>` 标签，始终未渲染下划线。
- **与粗体 `**` 不一致**：atomic 的 `StrongEmphasis` mark 在光标行仍应用加粗样式（`INLINE_MARK_CLASS` 不依赖 activeLines，仅 `**` 标记可见），而下划线是「整行跳过」——标签可见 + 文字无样式，体验更差。
- 用户期望：下划线立即渲染（标签隐藏、文字下划线），而非显示 `<u>` 标签。
- 修复方向：underlineDecoration 去掉光标行揭示分支，**恒隐藏 `<u>`/`</u>` 标签、内容恒加下划线**（对齐引用 `>` 恒隐藏契约）。

### 问题 7：内联格式无快捷键，下划线/粗体/斜体不能「完成/取消」切换

- 现状：`markdownKeymap`（lang-markdown）仅有 Enter/Backspace（`index.js:398-401`），无 Ctrl+B/I/U。工具栏 bold/italic/underline（MarkdownToolbar.tsx:82-84）走 `wrap('**','**')`/`wrap('*','*')`/`wrap('<u>','</u>')`——仅「包裹」语义，重复触发会嵌套（`****文字****`），无「取消」。
- 用户期望：Ctrl+U 下划线完成/取消；Ctrl+B 粗体、Ctrl+I 斜体同样支持（快捷键 toggle）。下划线恒隐藏后（R6）无需手动删标签，通过工具栏或快捷键 toggle 即可完成/取消。
- 修复方向：`MarkdownInsertApi` 新增 `toggleInline(open, close, nodeName?)`（选中包裹/取消；无选中光标在格式内取消、否则生成空标记居中）；工具栏 bold/italic/underline 改用 toggle；AtomicEditor 加 `Mod-b`/`Mod-i`/`Mod-u` keymap。

## Requirements

- R1：引用块内 Enter 延续引用；空引用行行尾 Enter 立即退出引用（删除 `>`），之后输入为普通正文。退出引用后光标落在纯空行。
- R2：列表圆点第一层 `•` 与第三层 `▪` 颜色加深（foreground 级）、字号放大，圆/方视觉可辨；第二层 `○`（空心）不要求同等待遇。
- R3：公式块上下间距明显减小；公式上下有文字时点击公式可进入编辑（reveal 源码）；方向键在公式上下移动定位正确（无 heightmap 错位）。
- R4：链接文本与链接图标为蓝色 `#3b82f6`，hover 更深（`#2563eb`），深浅色模式下均清晰。
- R5：各标题字号在当前基础上增大 ~8%；标题下方显示一条浅色细分隔线。
- R6：下划线 `<u>…</u>` 恒渲染——`<u>`/`</u>` 标签在任意行（含光标行）隐藏，内容恒加下划线；工具栏无选中点下划线时标签隐藏、光标居中可直接输入。
- R7：内联格式快捷键 + toggle——Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+U 下划线，均可「完成/取消」（选中包裹/取消、无选中光标在格式内取消、否则生成空标记光标居中）；工具栏 bold/italic/underline 按钮同步改为 toggle 语义（不再嵌套包裹）。

## Acceptance Criteria

- [ ] AC1：`> 引用` 按 Enter → 光标在新行（继续引用，输入仍为引用）；再按 Enter → 光标在纯空行（非引用）；继续输入为普通正文，`>` 不残留、不叠加。
- [ ] AC2：第一层 `•` 与第三层 `▪` 颜色深于现状、字号大于现状，圆/方可肉眼区分；列表项文字列缩进对齐不因圆点放大而错位（勾选框/有序列表对齐不受影响）。
- [ ] AC3：块公式 `$$x$$` 上下有文字时，上下间距比现状明显减小；点击公式内容/周边空白可进入编辑（显示 `$$x$$` 源码）；公式上下方向键移动定位准确。
- [ ] AC4：链接文本渲染为 `#3b82f6` 蓝色（含 hover 变深），链接图标同色；深/浅色主题下均可辨。
- [ ] AC5：标题字号比现状明显增大，标题下方可见一条浅色细线。
- [ ] AC6：`<u>文字</u>` 在光标行与非光标行均渲染为下划线（`<u>`/`</u>` 不可见），无 `<u></u>` 标签残留；工具栏无选中点下划线后光标居中、输入即时下划线。
- [ ] AC7：Ctrl+B 选中文字加粗、再次触发取消（不嵌套）；Ctrl+I 斜体、Ctrl+U 下划线同语义；无选中 Ctrl+B/I/U 生成空标记光标居中；光标在已加粗/斜体/下划线文字内触发对应快捷键可取消。工具栏 bold/italic/underline 与快捷键行为一致。
- [ ] AC8：round-trip 字节级一致（保存→重开源码不变）；`npm run smoke:editor` 全部通过；`npm run typecheck`、`npm run build` 通过。

## Out of Scope

- 不改动数据层 / 保存逻辑 / MarkdownInsertApi 接口（NoteView / MarkdownToolbar / MetaInfoPanel 零改动）。
- 不改动表格、图片、代码块、wiki-links 等 atomic 其余功能。
- 不新增 Markdown 语法；引用 `>` 仍保持「恒隐藏」（所见即所得契约不变）。
- 标题 `#`/粗体 `**` 等仍保持「光标行揭示源码」的 Obsidian 标准行为（仅引用 `>` 与下划线 `<u>` 恒隐藏，契约变更见 R6）。
- 快捷键仅覆盖加粗/斜体/下划线三项内联格式（高亮/删除线/内联代码/公式等不新增快捷键，超出本次范围）。

## 任务结构决策

单一任务，不拆 parent/child：7 项改动集中在 `atomicTheme.css`（R2/R3/R4/R5）+ `AtomicEditor.tsx`（R1/R7 keymap）+ `underlineDecoration.ts`（R6）+ `markdownInsertApi.ts`（R7 toggle）+ `MarkdownToolbar.tsx`（R7 toggle）+ 可能 `mathExtension.ts`（R3 验证），共享同一 dev-server 手动验证 + `smoke:editor` 冒烟，单点改动过小、拆 7 个 child 的归档/验收开销远超收益。
