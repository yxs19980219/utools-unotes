# 实施计划：CM6 即时渲染（回滚 + atomic-editor 集成）

## 前置

- [ ] 更新 spec：editor.md 标记 Milkdown 路线废弃（后续 3.3 统一改）。

## 实施清单（按序）

### 阶段 0：回滚与基线验证

1. `git revert 79a0425`（恢复 CM6 基线：CodeMirrorEditor/装饰/widget/MarkdownView/旧 ui-smoke/offset 契约）。
2. 基线验证：`npm run typecheck && npm run build && npm run smoke:* && npm run ui-smoke` 全绿。
3. 卸载 Milkdown 依赖（revert 不处理 package.json 增量，手动 `npm uninstall @milkdown/* katex` 中 katex 将在公式扩展时重装）。

### 阶段 1：可行性原型（决策 O1/O2/O4）

4. 安装 `@atomic-editor/editor` + `codemirror-live-markdown`（锁版本）。
5. 临时页面集成：默认内容含公式/任务/引用/代码块/分割线/表格：
   - atomic MarkdownEditor（组件态）+ extensions 挂 mathPlugin/blockMathField
   - 验证：光标行源码、非光标行渲染、公式 KaTeX、任务 checkbox 点击写回、
     表格直编、代码高亮、深浅色、体积（dist 解压 + zip）
6. 记录：兼容性结论（O1）、主题方案（O2）、体积（O4）；不通过则切换备选（拆散扩展/自研公式扩展）。

### 阶段 2：产品集成

7. 新建 `src/components/Editor/AtomicEditor.tsx`（或直接替换 CodeMirrorEditor 内部实现）：
   - 对外契约不变：value/onChange/onSave/placeholder/autoFocus + forwardRef MarkdownInsertApi
   - extensions 组装：atomic 内置 + mathExtension + 主题 + Ctrl+S keymap + 大纲 offset 跳转
   - 外部 value 变化（切笔记）→ 编辑器内 replace（atomic handle 或 CM6 dispatch）
8. `milkdownApi.ts` → 改回 `codeMirrorApi.ts`（CM6 语义，jumpTo=offset，block 行级/块级插入，
   公式块 `$$`、代码块围栏、表格模板、hr）。
9. 只读态（归档）切换 atomic readOnly（O3 结论；若选 MarkdownView 则跳过）。
10. 主题：EditorView.theme 变量映射 + `.dark` 覆盖（改名移植 milkdownTheme.css 思路）。
11. 清理：删除 milkdownTheme.css/milkdownApi.ts/MilkdownEditor.tsx（若不再引用）；
    MarkdownToolbar/NoteView/MetaInfoPanel 契约核对（offset 已随 revert 恢复）。

### 阶段 3：测试与收尾

12. ui-smoke 恢复 CM6 断言（revert 已带旧版）→ 追加新断言：公式渲染（.cm- 选择器待定）、
    无斜杠/块手柄（R11）；新增/改造 smoke-editor 专项（公式/深色/大纲/工具栏/round-trip 字节一致）。
13. 全量验证：typecheck/build/smoke/smoke:stores/smoke:outline/smoke:tableModel/
    smoke:tableOps/smoke:editor/ui-smoke。
14. 体积复测 ≤ 5MB（AC13）；KaTeX 字体裁剪（可选优化）。
15. 手动回归：新建/编辑/保存/重开、归档只读、大纲跳转、工具栏全按钮、图片、
    深浅色、Ctrl+S、长文档（500+ 行）流畅度。
16. spec 更新（3.3）：editor.md 重写为 CM6 即时渲染契约。
17. 分阶段 commit（回滚 → 原型 → 集成 → 测试），消息遵循仓库风格。

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
| src/components/Editor/CodeMirrorEditor.tsx | 内核替换核心 | revert 集成 commit |
| src/components/Editor/CodeMirrorApi.ts | 工具栏 API 实现 | 同上 |
| src/components/NoteView.tsx | 编辑/只读分支 | 同上 |
| package.json | atomic/live-markdown 依赖 | 锁版本，独立 commit |

## 检查门

- 阶段 0 完成：基线全绿（验证回滚干净）。
- 阶段 1 完成：O1/O2/O4 决策记录（原型结论写入任务 notes）。
- 阶段 2 完成：AC1-AC11 功能断言可测。
- 阶段 3 完成：AC12/AC13 通过后进入 spec 更新与提交。
