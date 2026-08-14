# 实施计划：编辑器渲染二次打磨

## 有序检查清单

### 阶段 A：纯 CSS 改动（`src/components/Editor/atomicTheme.css`）

1. **R4 链接蓝色** — 改 `.atomic-cm-editor` 变量块：
   - `--atomic-editor-link: var(--foreground)` → `#3b82f6`
   - `--atomic-editor-link-hover: var(--muted-foreground)` → `#2563eb`

2. **R2 列表圆点** — 文件末尾追加：
   - `.cm-atomic-bullet { color: var(--foreground); transform: scale(1.3); transform-origin: center; }`

3. **R3 公式间距** — 文件末尾追加：
   - `.cm-math-block .katex-display { margin: 0.15em 0; }`

4. **R5 标题字号 + 细线** — 文件末尾追加：
   - 六个 `.cm-line.cm-atomic-h1..h6` 的 font-size 覆盖（1.45/1.3/1.18/1.06/1/0.95em）
   - 六个标题行 `position: relative`
   - 六个 `::after` 底部 `1px solid var(--border)` 细线

### 阶段 B：R1 引用 Enter keymap（`src/components/Editor/AtomicEditor.tsx`）

5. 新增 `exitBlockquoteOnEnter(view)` 函数（组件外，纯函数）：空引用行行尾 Enter → 删除 `>` 退出。
6. 在扩展列表追加 `Prec.high(keymap.of([{ key: 'Enter', run: exitBlockquoteOnEnter }]))`（放在 `Prec.high(Mod-s)` 附近，先于 `markdownKeymap` 匹配）。
7. `import { EditorSelection } from '@codemirror/state'`（确认已引入或补引入；`keymap`/`EditorView`/`Prec` 已在）。

### 阶段 B2：R6 下划线恒渲染（`src/components/Editor/extensions/underlineDecoration.ts`）

8. `buildUnderlineDecorations` 删除光标行揭示：删 `lines` 计算与 `if (lines.has(doc.lineAt(from).number)) continue`，恒隐藏 `<u>`/`</u>`、内容恒 mark `cm-underline`。

### 阶段 B3：R7 内联格式快捷键 + toggle

9. `src/components/Editor/markdownInsertApi.ts`：
   - `MarkdownInsertApi` 接口加 `toggleInline(open: string, close?: string, nodeName?: string): void`。
   - 实现 toggle 语义：有选中前后缀判断包裹/取消；无选中 `nodeName` 用 `syntaxTree` 上溯取消、下划线用正则找包裹对取消、均未命中生成空标记光标居中。
10. `src/components/Editor/MarkdownToolbar.tsx`：bold/italic/underline 三个工具 `run` 从 `wrap(...)` 改为 `api.toggleInline('**','**','StrongEmphasis')` / `toggleInline('*','*','Emphasis')` / `toggleInline('<u>','</u>')`。
11. `src/components/Editor/AtomicEditor.tsx`：追加 `Prec.high(keymap.of([...Mod-b / Mod-i / Mod-u...]))`，命令调用 `api.toggleInline(...)` 并 `return true`（阻止浏览器默认）。

### 阶段 C：验证

12. `npm run typecheck`
13. `npm run build`
14. dev server 手动验证（`npm run dev`）：
    - R1：`> 引用` → Enter 续引用 → 空引用行再 Enter 退出，后续输入为普通正文
    - R2：三级列表 `•`/`○`/`▪` 视觉，`•`/`▪` 加深加大、可区分，文字列对齐不错位
    - R3：`$$x$$` 上下有文字时间距减小、点击可进入编辑、方向键定位准确
    - R4：链接/图标蓝色、hover 变深
    - R5：标题字号增大、下方细线可见
    - R6：`<u>文字</u>` 光标行/非光标行均渲染下划线、无 `<u></u>` 标签残留
    - R7：Ctrl+B/I/U 选中 toggle、无选中生成空标记居中、光标在格式内取消；工具栏三按钮与快捷键一致（不嵌套）
15. `npm run smoke:editor` 全量回归（round-trip、引用、列表、公式、下划线、fence、工具栏）。

## 验证命令

```bash
npm run typecheck
npm run build
npm run smoke:editor   # 需 dev server 在 5173 运行（npm run dev）
```

## 风险文件 / 回滚点

- `src/components/Editor/atomicTheme.css`
- `src/components/Editor/AtomicEditor.tsx`
- `src/components/Editor/extensions/underlineDecoration.ts`
- `src/components/Editor/markdownInsertApi.ts`
- `src/components/Editor/MarkdownToolbar.tsx`

回滚：`git checkout` 上述五文件即可整体回退（无 patches/依赖变更）。

## 关键注意

- R2 用 `transform: scale` 而非 `font-size`（后者因 em 相对自身会连带放大 `.cm-atomic-list-marker` 的 0.9em alcove，破坏缩进对齐）；实现时实测 scale 视觉溢出情况，必要时调低到 1.2。
- R3 若修 margin 后点击仍未修复，排查 `mathExtension.ts` 的 mousedown/revealPos（不预改）。
- R1 keymap 返回 false 时须正确 fallthrough 到 markdownKeymap，勿 return true 阻断列表续行。
- R6 恒隐藏后删除下划线靠 R7 toggle（工具栏/快捷键），smoke:editor 现有「输入后按 Enter 离开该行再断言 `.cm-underline`」的断言仍成立，无需改测试。
- R7 无选中取消的边界：`resolveInner(from, 1)` 取含光标最小节点，验证光标在 `**` 边界的判空行为；下划线正则 `<u>([^<]*?)</u>` 复用（或导出）underlineDecoration 的 `UNDERLINE_RE`，避免重复定义。
- 提交前按 Phase 3 更新 `spec/frontend/editor.md`（引用 Enter 退出语义 + 圆点/公式/链接/标题样式 + 下划线恒隐藏 + toggle API/快捷键）。
