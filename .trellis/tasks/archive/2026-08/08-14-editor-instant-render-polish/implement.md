# 实施计划：编辑器即时渲染优化

## 有序检查清单

### 阶段 A：项目内改动（不动 node_modules）

1. **R2c/R3 setext 禁用** — `src/components/Editor/AtomicEditor.tsx`
   - `markdown({ extensions: highlightMarkdown })` → `extensions: [highlightMarkdown, { remove: ['SetextHeading'] }]`
   - 验证：`typecheck` 通过。

2. **R1 宽度** — `src/components/Editor/atomicTheme.css`
   - 追加 `.atomic-cm-editor .cm-content { max-width: none; margin-inline: 0; padding-inline: 0.75rem; }`

3. **R6 公式高度** — `src/components/Editor/atomicTheme.css`
   - `.cm-math-block` padding `0.4em 0` → `0.1em 0`

4. **R5 工具栏占位** — `src/components/Editor/MarkdownToolbar.tsx`
   - 移除 8 个 wrap 工具的 `placeholder` 第三参数（bold/italic/underline/strike/highlight/inline-code/inline-math/link）。

### 阶段 B：patch atomic-editor（R2a/R2b/R4）

5. 安装 `patch-package` 并锁定版本：
   - `npm i -D patch-package`
   - `package.json` 将 `@atomic-editor/editor` `^0.6.2` → `0.6.2`（精确锁定）
   - `package.json` scripts 加 `"postinstall": "patch-package"`

6. 改 `node_modules/@atomic-editor/editor/dist/inline-preview.js`（3 处）：
   - **R2a**：`BulletWidget` 加 depth 构造/eq/toDOM 按 `['•','○','▪'][depth%3]`；删 `BULLET_WIDGET` 单例；ListMark bullet 分支 `new BulletWidget(depth)`。
   - **R2b**：`LIST_LEVEL_EM = 0.6` → `1.2`。
   - **R4**：`HIDEABLE_SYNTAX` 处理 `else` 前插 `else if (node.name === 'QuoteMark') { shouldHide = true; }`。

7. 生成并持久化补丁：
   - `npx patch-package @atomic-editor/editor`
   - 确认生成 `patches/@atomic-editor+editor+0.6.2.patch`。

### 阶段 C：验证

8. `npm run typecheck`
9. `npm run build`
10. dev server 探针复测（复用本任务探针思路）：
    - 三级列表圆点 `•/○/▪`、第四级循环回 `•`
    - 缩进层级肉眼可辨
    - `文本↵-` 上方文本不变黑体；`文本↵====` 不渲染标题；`---` 单独一行仍 HR
    - 引用光标行 `>` 隐藏；勾选框 `- [ ]` 全场景隐藏
    - 工具栏无选中点击生成 `****` 光标居中、无文字占位
    - 编辑区两侧留白减小、公式块高度减小
11. `npm run smoke:editor` 全量回归（重点：round-trip 字节级一致、任务勾选、引用、分割线）。

## 验证命令

```bash
npm run typecheck
npm run build
npm run smoke:editor   # 需 dev server 在 5173 运行
```

## 风险文件 / 回滚点

- `patches/@atomic-editor+editor+0.6.2.patch`（新增）
- `src/components/Editor/AtomicEditor.tsx`
- `src/components/Editor/atomicTheme.css`
- `src/components/Editor/MarkdownToolbar.tsx`
- `package.json`（patch-package devDep + postinstall + 版本锁定）

回滚：`git checkout` 上述项目文件 + 删 `patches/` + `npm i` 还原依赖。

## 关键注意

- 阶段 A 先做并单独验证（不依赖 patch），阶段 B 再 patch，最后统一跑 smoke。
- 列表标记深度循环、缩进值、宽度内边距均为默认建议值，若用户对最终 summary 提异议再调。
- 提交前按 Phase 3 更新 spec（editor 相关契约变更：setext 禁用、引用光标行隐藏）。
