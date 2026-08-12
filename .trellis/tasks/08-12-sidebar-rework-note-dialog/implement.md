# Implement — 侧边栏视图栏重构 + 新建笔记小窗 + 顶栏简化

## 有序执行清单

### 阶段 1：侧边栏视觉（R1/R2/R3/R6 的侧边栏侧）

- [ ] 1.1 `src/index.css`：`--sidebar: #fafafa → #f0f0f0`（仅浅色）
- [ ] 1.2 `src/App.tsx`：`aside` `w-48 → w-44`；视图容器改 `flex h-11 items-center px-2`；SidebarList 下方加齿轮区（`mt-auto`，按钮内联在 App 或 ViewSwitcher 内）
- [ ] 1.3 `src/components/ViewSwitcher.tsx`：VIEWS 去 settings；TabsList 覆盖 `bg-transparent p-0`；TabsTrigger `h-8 px-1 text-[0.9rem] hover:bg-accent/60`；加设置齿轮按钮（`aria-label="设置"`、选中高亮）
- [ ] 1.4 `src/stores/ui.ts`：加 `lastBrowseView`（setView 时非 settings 记录）
- [ ] 1.5 `src/components/SidebarList.tsx`：settings 分支按 lastBrowseView 渲染，删 Empty 空态
- [ ] 门禁：`npm run typecheck`

### 阶段 2：右键删除悬停（R4）

- [ ] 2.1 `src/components/ui/context-menu.tsx`：destructive 项 `focus:bg-destructive focus:text-destructive-foreground`
- [ ] 门禁：`npm run typecheck`

### 阶段 3：对象详情顶栏简化（R5）

- [ ] 3.1 `ContentHeader.tsx` ObjectHeaderActions：删元数据圆角块、归档/编辑/删除 icon、恢复按钮；新笔记最右；新增 ℹ Popover（`InfoIcon`、`rounded-full`、无元数据隐藏）；操作区顺序 [排序] [ℹ] [新笔记]
- [ ] 3.2 归档对象只读分支：仅 排序 + ℹ + 已归档 badge
- [ ] 门禁：`npm run typecheck`

### 阶段 4：顶栏对齐（R6）

- [ ] 4.1 `ContentHeader.tsx`：各分支标题字号 `text-[0.9rem]`（h-11 保持）
- [ ] 门禁：`npm run typecheck`

### 阶段 5：笔记表单 Dialog 化 + 标签联想修复（R7/R8）

- [ ] 5.1 `TagInput.tsx`：onChange 兜底 `setOpen(true)`
- [ ] 5.2 新 `src/components/NoteFormDialog.tsx`；`NoteForm.tsx` 抽字段区（标题+标签+兜底对象选择）为可复用部分，外层容器改 Dialog 布局，保存/取消在 DialogFooter；Esc/遮罩关闭 = stopEditing
- [ ] 5.3 `ContentArea.tsx`：note 编辑态分支改渲染 `<NoteFormDialog />`
- [ ] 门禁：`npm run typecheck`

### 阶段 6：ui-smoke 更新 + 全量验证

- [ ] 6.1 ui-smoke：`tab 设置` 全部改齿轮按钮（`getByRole('button', { name: '设置' })`）；归档对象"恢复按钮"断言改右键菜单验证（AC2 的 `恢复 count===1` 改 `count===0` + 右键含恢复）；新建笔记断言适配 Dialog（选择器不变应无需改，跑一遍确认）；新增：标签联想断言（输入字符 → command-item 出现）、ℹ 元数据 Popover 断言、侧边栏颜色断言（可选）
- [ ] 6.2 `npm run typecheck && npm run smoke && npm run smoke:stores && npm run smoke:decorations && npm run build`
- [ ] 6.3 dev server + `npm run ui-smoke` 全绿
- [ ] 6.4 手动验收：视觉（色差/对齐/齿轮）、右键悬停、ℹ Popover、Dialog 小窗、标签联想

## 验证命令

```bash
npm run typecheck
npm run smoke && npm run smoke:stores && npm run smoke:decorations
npm run build
# dev server 5173 启动后
npm run ui-smoke
```

## 风险文件与回滚点

| 文件 | 风险 | 缓解 |
|---|---|---|
| `ContentHeader.tsx` | 操作区大改（删按钮+ℹ Popover） | 阶段 3 独立过门禁 |
| `NoteForm.tsx` / `ContentArea.tsx` | Dialog 化（渲染路径变更） | 阶段 5 独立过门禁；保存逻辑不动 |
| `ui-smoke.mjs` | 设置/恢复入口断言大面积变更 | 阶段 6 逐项更新后全量跑 |
| `stores/ui.ts` | lastBrowseView 状态流 | 门禁 + smoke-stores 跑通 |

回滚：独立 commit；`git revert` 整体回退。

## 开工前检查

- [ ] 用户已批准最终规划总结
- [ ] `task.py start` 已执行
- [ ] `trellis-before-dev` 已加载（本任务沿用 frontend spec，重点：state-management 实时保存/无 dirty、component-guidelines 色阶规范、hook-guidelines ref timer）
