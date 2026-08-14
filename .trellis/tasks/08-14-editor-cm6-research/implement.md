# 实施计划：CM6 即时渲染（AtomicEditor 替换 Milkdown）

## 前置

- [ ] 记录 spec：`editor.md` 当前描述 Milkdown 架构，3.3 统一改为 CM6 即时渲染契约。

## 实施清单（按序）

### 阶段 0：依赖切换（独立 commit，保持可编译）

1. 安装 atomic-editor 及 peer deps（Milkdown 暂保留，先共存）：
   ```bash
   npm install @atomic-editor/editor @codemirror/commands @codemirror/autocomplete \
     @codemirror/language @codemirror/search @lezer/common @lezer/highlight @lezer/markdown \
     @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css
   ```
2. `npm run typecheck` 通过（Milkdown 仍在，无破坏）。

### 阶段 1：内核与自研扩展（新建文件）

3. `src/components/Editor/extensions/mathExtension.ts`：CM6 `ViewPlugin` + KaTeX，
   行内 `$...$`（`Decoration.replace` → inline Widget）/ 块级 `$$...$$`（block Widget），
   光标行显示源码。
4. `src/components/Editor/extensions/underlineDecoration.ts`：`<u>…</u>` 行内
   `Decoration.mark`（class + `text-decoration: underline`），纯渲染不改源码。
5. `src/components/Editor/markdownInsertApi.ts` 重写为 CM6 实现：持 `EditorView`，
   `wrap/block/insertImage` 走 `view.dispatch({changes: ...})`；`jumpTo(item)` 用
   `item.offset`（`selection: {anchor: offset}` + `scrollIntoView`）；`focus`。
   `createMarkdownInsertApi(getView: () => EditorView | null)`。
6. `src/components/Editor/AtomicEditor.tsx`：自组 `EditorView`（扩展清单见 design.md），
   props/ref 与 MilkdownEditor 完全一致；`updateListener` docChanged → onChange；
   `Prec.high` `Mod-s` → onSave；挂载 `readOnlyExtension(readOnly)`；`autoFocus` 聚焦。

### 阶段 2：切换（NoteView/ContentArea/Toolbar）

7. `ContentArea.tsx`：`<NoteView key={activeNoteId} noteId={activeNoteId} />`。
8. `NoteView.tsx`：`MilkdownEditor` → `AtomicEditor`；删除「重置 draft」的 `useEffect`
   （key 重挂载接管）；import 调整。
9. `MarkdownToolbar.tsx`：`import type { MarkdownInsertApi } from './AtomicEditor'`。

### 阶段 3：清理与主题

10. 删除 `MilkdownEditor.tsx`、`milkdownTheme.css`、`plugins/customMarks.ts`。
11. 卸载 Milkdown：`npm uninstall @milkdown/crepe @milkdown/kit`。
12. 新增 `atomicTheme.css`：`[data-theme]` 作用域把 `--atomic-editor-*` 映射项目色板；
    `@atomic-editor/editor/styles.css` 引入。
13. `npm run typecheck` 全绿。

### 阶段 4：测试与收尾

14. 改造 `scripts/ui-smoke.mjs` / `smoke-editor.mjs`：Milkdown 选择器 → CM6 断言
    （`.cm-editor`、`.cm-line`、公式 `.katex`、任务勾选框、offset 大纲跳转、
    round-trip 字节一致、无斜杠/块手柄）。
15. 全量验证：`npm run typecheck && npm run build && npm run smoke && npm run smoke:stores
    && npm run smoke:outline && npm run smoke:tableModel && npm run smoke:tableOps
    && npm run smoke:editor && npm run ui-smoke`。
16. 体积复测 ≤ 5MB（Milkdown 移除后应下降）；必要时裁剪 KaTeX 字体。
17. 手动回归：新建/编辑/保存/重开、归档只读、大纲跳转、工具栏 19 项、图片、
    深浅色、Ctrl+S、长文档（500+ 行）流畅度。
18. spec 更新（3.3）：`editor.md` 重写为 CM6 即时渲染契约。
19. 分阶段 commit（依赖 → 内核 → 切换 → 清理/主题 → 测试），消息遵循仓库风格。

## 验证命令

```bash
npm run typecheck
npm run build
npm run smoke && npm run smoke:stores && npm run smoke:outline && npm run smoke:tableModel && npm run smoke:tableOps
npm run smoke:editor
npm run ui-smoke
```

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|------|------|------|
| src/components/Editor/AtomicEditor.tsx | 内核核心 | revert 本任务 commit |
| src/components/Editor/markdownInsertApi.ts | 插入命令正确性 | 同上 |
| src/components/Editor/extensions/mathExtension.ts | 公式装饰 | 同上（独立文件可替换） |
| src/components/NoteView.tsx + ContentArea.tsx | key 重挂载语义 | 同上 |
| package.json | 依赖切换 | 独立 commit 锁定版本 |

## 检查门

- 阶段 0 完成：typecheck 通过（依赖共存）。
- 阶段 1-2 完成：AC1-AC11 可测（编辑器换核、工具栏/大纲可用）。
- 阶段 3 完成：Milkdown 全清、主题适配。
- 阶段 4 完成：AC12/AC13 通过后进入 spec 更新与提交。
