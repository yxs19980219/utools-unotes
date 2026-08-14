# 编辑器换型调研：CM6 即时渲染（Obsidian 式）

## Goal

将笔记编辑器从 Milkdown（ProseMirror）换成 **CodeMirror 6 + 成熟扩展 + 自研缺口**，
获得 Obsidian Live Preview 式简洁编辑体验：文档模型 = 纯 Markdown 文本（源码即真相），
光标行显示源码、非光标行渲染视觉样式，不改写用户原文。

## 背景与痛点（用户反馈，2026-08-14）

当前 Milkdown (CrepeBuilder) 体验差，四大痛点：

1. **输入卡顿 / 性能**：长文档打字延迟。
2. **源码被改写**：WYSIWYG 序列化改变原始 markdown（`**bold**` 星号被吃掉）。
3. **观感 / 主题不简洁**：界面不像 Obsidian 清爽，块元素样式重。
4. **难以定制**：ProseMirror 插件体系学习成本高，加功能难。

**根源**：Milkdown/Tiptap 基于 ProseMirror，文档模型是 AST——输入 `**bold**` 时星号被
消费掉，光标返回时"无源码可揭示"。而 CodeMirror 6 走相反路线：**文档就是源码字符串**，
装饰（decorations/widgets）只叠加在视图上。这使"光标行显示源码、其余渲染"成为自然
架构而非对抗。这也是 Obsidian 自身的实现方式（CM6 + 装饰）。

## 历史反复（避免重蹈覆辙）

```
① 自研 CM6 装饰系统    → 早期基线（markdownDecorations.ts 纯自研）
② Milkdown Crepe WYSIWYG → 79a0425，被否决（块编辑，改 markdown 逻辑）
③ Revert + CM6/atomic-editor → 8c7afc6，Obsidian 式即时渲染（已实现过！）
④ Milkdown CrepeBuilder 即时渲染 → d9dfb6d，当前（本次要换掉）
```

阶段③ 的完整实现仍在 git 历史（`AtomicEditor.tsx` 186 行、`mathExtension.ts` 348 行、
`codeMirrorApi.ts` 153 行、`atomicTheme.css` 116 行），可恢复为参考/起点。

## 调研结论（2026-08-14 联网调研）

**技术方向已定**：CodeMirror 6 内核 + Live Preview 装饰系统。项目已具备 CM6 基础
（`@codemirror/state`/`view`/`lang-markdown` 已在 dependencies）+ KaTeX 0.18.4。

2026 年 CM6 即时渲染生态（按成熟度排序）：

| 方案 | 成熟度 | 公式 | 表格 | 体积 | 定制性 |
|------|--------|------|------|------|--------|
| A. @atomic-editor/editor v0.6.2 | 高（50 回归） | 需补 | WYSIWYG | 中 | 拆散扩展 |
| B. codemirror-live-markdown v0.5.1 | 中（alpha） | ✅KaTeX | 可编辑 | 轻 | 模块化 |
| C. fedoup/markdown-editor v0.2 | 中 | 无 | 弱 | ~9kB | CSS 变量 |
| D. @silkdown/core pre-1.0 | 中 | 无 | 无 widget | 轻 | 框架无关 |

要点：

- **A**（npm 周下载 3.9k，MIT，作者产品 Atomic 实盘）：`AtomicCodeMirrorEditor` React
  组件 + 可拆散低级扩展（`inlinePreview`/`tables`/`imageBlocks`/`atomicEditorTheme`）。
  源码字节级 round-trip 保证；虚拟化布局稳定（500 页流畅）；~50 个 Playwright 回归。
  **缺公式**（KaTeX 需自补）。
- **B**：纯 CM6 扩展集合，模块化（`mathPlugin`/`blockMathField`/`tableField`/
  `tableEditorPlugin`/`codeBlockField`/`imageField`/`linkPlugin`）。**含 KaTeX 公式**，
  但块公式用 ` ```math ` 语法而非标准 `$$`。
- **C**：最轻量，`Decoration.mark` + `Decoration.replace` 双装饰，直接读 `--foreground`/
  `--border` 等 design-token（本项目 shadcn 变量可零成本适配）。无公式、表格弱。
- **D**：框架无关，安全 URL 策略；表格只显示源码（无 widget）。

**推荐组合**：**A（atomic-editor）为装饰主力 + 自研轻量公式扩展（KaTeX）**。
理由：成熟度最高（回归测试 + 实盘）、项目阶段③已验证过这条路线、公式是唯一缺口
（且已有 `mathExtension.ts` 348 行自研先例，标准 `$...$`/`$$...$$` 语法）。

## Requirements

- R1 文档模型 = 纯 Markdown 文本：编辑回写**字节级**不改写用户原文（AC 对应 round-trip）。
- R2 行内公式 `$...$` / 公式块 `$$...$$` KaTeX 渲染；光标行显示源码。
- R3 任务列表 `- [ ]`/`- [x]` 渲染为可点击勾选框，点击写回 `[x]`。
- R4 引用块、分割线 `---` 渲染为块样式/水平线；光标行显示源码。
- R5 代码块语法高亮；语言选择交互合理（浮层式）。
- R6 表格即时渲染 + 单元格可编辑（WYSIWYG）。
- R7 标题/加粗/斜体/删除线/行内代码/`==高亮==`/`<u>` 下划线/链接/图片即时渲染。
- R8 无整行灰底高亮（live preview 视觉习惯）；无块编辑形态（无斜杠/块手柄）。
- R9 工具栏 19 项、Ctrl+S、500ms 防抖保存、大纲跳转（offset 契约）、图片插入保持。
- R10 归档只读态用同一内核渲染（装饰照常，禁止编辑）。
- R11 深浅色主题适配项目 shadcn/next-themes 色板（CSS 变量）。
- R12 输入流畅度 ≥ 当前 Milkdown（性能不退化，长文档冒烟验证）。

## 决策记录（已拍板，2026-08-14）

- D1 装饰主力：**atomic-editor**（@atomic-editor/editor，锁 0.6.2）。
- D2 公式：**自研轻量 KaTeX 扩展**（标准 `$...$`/`$$...$$` 语法；旧 `mathExtension.ts`
  348 行仅作参考，不照搬）。
- D3 起点：**从零重建**（不 `git revert`、不复用旧 AtomicEditor.tsx；直接在当前代码上
  新写 CM6 + atomic-editor 组件替换 MilkdownEditor）。

## Out of Scope

- 块编辑器形态（Milkdown/ProseMirror/Tiptap/Lexical 路线永久排除）。
- mermaid 流程图、双栏分屏、源码/预览切换按钮、协作（Y.js）、云同步。
- 存储格式不变（纯 markdown）。

## Acceptance Criteria

- [x] AC1 round-trip：编辑→保存→重载源文本字节级一致（非光标行无序列化改写）。
- [x] AC2 公式（行内/块）非光标行 KaTeX 渲染、光标行源码可编辑。
- [x] AC3 任务勾选框渲染 + 点击切换写回 `[x]`。
- [x] AC4 引用块/分割线渲染，`>` 仅光标行可见。
- [x] AC5 代码块语法高亮（语言经 fence info string 指定，无独立浮层——与 Obsidian 一致）。
- [x] AC6 表格即时渲染 + 单元格可编辑。
- [x] AC7 工具栏 20 项可用；Ctrl+S；防抖保存；大纲跳转（offset）正确。
- [x] AC8 归档只读渲染一致（公式/高亮/表格），禁止编辑。
- [x] AC9 深浅色主题可读。
- [x] AC10 无斜杠命令/块手柄；无整行灰底。
- [x] AC11 长文档（600 行）输入流畅（7200ms，无渲染错误）。
- [x] AC12 typecheck/build/全部 smoke/ui-smoke 通过。
- [x] AC13 dist 解压 1.68 MB ≤ 5 MB。
