# 编辑器即时渲染优化与 bug 修复

## Goal

修复 CM6 即时渲染编辑器（atomic-editor 内核）的 6 项体验问题：编辑区宽度、列表标记与缩进、setext 标题误触发、语法符号残留、工具栏占位文字、公式块高度。让即时渲染更贴合 Obsidian 式 live preview 的期望。

## 已确认的技术事实（探针验证 + 源码定位）

### 问题 1：编辑区两侧留白过大
- 根因：`node_modules/@atomic-editor/editor/dist/styles/inline-preview.css` 第 39-42 行
  `.atomic-cm-editor .cm-content { max-width: var(--atomic-editor-measure, 70ch); margin-inline: auto; padding-inline: 0.5rem; }`
- 70ch 内容列居中 → uTools 窄窗口两侧留白大。探针实测 `maxWidth 697.8px`（≈70ch）居中。
- 修复方向：在 `src/components/Editor/atomicTheme.css` 覆盖 `.cm-content` 的 max-width/margin（本项目已有 atomicTheme.css 做主题映射，可在此追加覆盖，不动 node_modules）。

### 问题 2：列表标记样式 + 缩进 + 两个 bug
- 2a 圆点样式：`inline-preview.js` 第 220-237 行 `BulletWidget` 固定渲染 `•`（单例 `BULLET_WIDGET`，`eq()` 恒 true），不区分层级。探针确认 depth 0/1/2 全是 `•`。
- 2b 缩进：`inline-preview.js` 第 319-321 行 `LIST_LEVEL_EM = 0.6`，每层仅 +0.6em。探针实测 padding-left：2em / 2.6em / 3.2em。
- 2c/2d 两个 bug 同根因：**setext heading 误触发**。`文本\n-` → SetextHeading2（上方文本 `cm-atomic-h2` 1.2em+700 黑体）；`文本\n====` → SetextHeading1（1.35em）。`LINE_CLASS_BY_BLOCK`（170-181 行）已含映射，渲染已生效。
- 探针确认：`文本\n====` 渲染成 H1 成功；单独 `====` 不渲染；`文本\n-` 渲染成 H2。

### 问题 3：`====` 语法
- 与问题 2c/2d 同属 setext 机制。用户已确认：标题用 `#`，**setext 标题完全禁用**。

### 问题 4：勾选框/引用 语法符号残留
- 引用 `>`：光标行显示源码 `>`（inline-preview.js 的 activeLines「光标行揭示源码」设计）。探针确认：光标行 `text = "> 引用正在输入"`，离开后 `>` 被隐藏。
- 勾选框 `-`：探针确认光标行与非光标行均渲染 checkbox、`- [ ]` 被隐藏。用户报告场景未完全复现，但诉求明确：**语法符号彻底隐藏（含光标行）**。
- 用户决策：光标行也彻底隐藏语法符号（完全所见即所得）。

### 问题 5：工具栏占位文字
- 根因：`src/components/Editor/markdownInsertApi.ts` 的 `wrap()`——无选中时插入 `before + placeholder + after`，placeholder 为「加粗文本/斜体文本/…」（MarkdownToolbar.tsx 第 82-89 行）。
- 期望：选中文字点击包裹；无选中生成空语法符号（如 `****`）+ 光标聚焦居中，不插入文字占位。

### 问题 6：公式块上下高度过大
- 根因：`src/components/Editor/atomicTheme.css` 第 41-45 行 `.cm-math-block { padding: 0.4em 0; text-align: center; }` + KaTeX displayMode 自带上下间距。
- 修复方向：减小 `.cm-math-block` padding。

## 关键技术结论

- setext 禁用可行：`@lezer/markdown` 的 `MarkdownConfig` 支持 `remove: ['SetextHeading']`；`@codemirror/lang-markdown` 的 `markdown()` 接受 `extensions: MarkdownExtension`（数组）。当前 AtomicEditor.tsx 第 160-164 行 `markdown({ ..., extensions: highlightMarkdown })` 可改为 `extensions: [highlightMarkdown, { remove: ['SetextHeading'] }]`。**无需改 node_modules**。
- 2a/2b/4 涉及 `inline-preview.js` 深层逻辑（BulletWidget / LIST_LEVEL_EM / activeLines），无法纯 CSS 解决（圆点是 textContent 字符、缩进是内联 style、activeLines 是 JS 分支）。需评估 patch/fork 方案（见 design.md）。

## Requirements

- R1：编辑区内容列放宽，减少两侧留白。
- R2a：列表标记按层级区分：depth 0 实心圆 `•`、depth 1 空心圆 `○`、depth 2 实心方形 `▪`，depth ≥ 3 循环（•→○→▪→•…）。
- R2b：列表父子缩进加大，层级区分明显。
- R2c：禁用 setext 标题：单个 `-`、`---`、`====` 均不再把上方文本变标题；`---` 单独一行仍为分割线（HR）。
- R3：`====` 不再渲染成标题（标题用 `#`，setext 禁用）。
- R4：勾选框 `- [ ]` 与引用 `>` 的语法符号在所有行（含光标行）彻底隐藏，完全所见即所得。
- R5：工具栏无选中时生成空语法符号 + 光标聚焦居中，不插入文字占位（占位文字「加粗文本」等全部移除）。
- R6：公式块上下高度减小。

## Out of Scope

- 不引入新的 Markdown 语法（`====` 不另作他用）。
- 不改动表格、图片、代码块、链接图标、wiki-links 等 atomic 其余功能。
- 不改变数据层 / 保存逻辑（round-trip 字节级一致契约保持）。

## Acceptance Criteria

- [ ] AC1：编辑区两侧留白明显减小（内容列宽度 ≥ 视口可用宽度减去少量 padding）。
- [ ] AC2a：三级列表分别渲染 `•`/`○`/`▪`，第四级回到 `•`。
- [ ] AC2b：父子列表缩进加大，肉眼可区分层级。
- [ ] AC2c/AC3：输入「文本↵-」后上方文本保持普通段落（不变黑体大字）；「文本↵====」不渲染成标题；`---` 单独一行仍渲染分割线。
- [ ] AC4：光标在引用行/勾选框行时，`>` 与 `- [ ]` 均被隐藏（checkbox/引用样式可见），离开行后一致。
- [ ] AC5：工具栏无选中点击「加粗」生成 `****` 且光标居中，无「加粗文本」文字残留；选中文字点击仍正确包裹。
- [ ] AC6：公式块渲染上下高度比现状明显减小，公式内容完整可读。
- [ ] AC7：round-trip 字节级一致（保存→重开源码不变），现有 smoke:editor 全部通过。

## Notes

- 项目已有 `src/components/Editor/atomicTheme.css` 做主题覆盖；已有 `mathExtension`/`underlineExtension` 自研扩展先例。
- 改 node_modules 需评估 patch-package / fork 方案（design.md 待定），并确保 `npm install` 后仍生效。
