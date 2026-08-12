# Implement — UI 去分割线改造 + 笔记实时保存链路简化

## 有序执行清单

### 阶段 1：DirtyGuard 机制删除（先删机制，减少后续重构干扰面）

- [ ] 1.1 `stores/ui.ts`：删除 pendingDirty/dirtyRoute/dirtyOnDiscard/setPendingDirty/requestRoute/cancelRoute/discardDirty（字段、接口、实现）
- [ ] 1.2 删除 `src/components/DirtyGuard.tsx`；`App.tsx` 移除 import 与 `<DirtyGuard />`
- [ ] 1.3 全部 requestRoute 调用点替换为直接调用（ContentHeader ×2、NoteCardList ×3、SidebarList ×8、ViewSwitcher ×1、NoteView ×1）
- [ ] 1.4 `NoteForm.tsx`：删 dirty 计算/两个 effect/setPendingDirty/handleCancel 清理；底部操作栏 `border-t` → `bg-muted/50`
- [ ] 1.5 `ObjectForm.tsx`：底部操作栏 `border-t` → `bg-muted/50`
- [ ] 门禁：`npm run typecheck` 通过（删字段后编译错误即为遗漏调用点）

### 阶段 2：NoteView 实时保存重构（核心）

- [ ] 2.1 删草稿机制（DRAFT_PREFIX/readDraft/writeDraft/clearDraft）
- [ ] 2.2 删 editingBody/enterEdit/cancelEdit/saveBody 旧路径；进入即编辑（非归档），`draft` 初始化并跟随 note 变化
- [ ] 2.3 300ms 防抖 + savingRef/pendingSaveRef 串行化保存（设计 3.2）；保存取 store 最新 note
- [ ] 2.4 卸载 flush 未落盘改动（设计 3.3）；Ctrl+S onSave 保留为立即 flush
- [ ] 2.5 删除「写正文」按钮、底部保存操作栏；编辑态顶部加元信息行（标签+时间，R13）；工具行去 `border-b`
- [ ] 2.6 只读态（归档）保留 MarkdownView 渲染路径
- [ ] 门禁：`npm run typecheck` + 手动验证（dev 模式）

### 阶段 3：视觉去线

- [ ] 3.1 `App.tsx` aside：`border-r border-border` → `bg-sidebar`
- [ ] 3.2 `ContentHeader.tsx`：三处顶栏去 `border-b`；元数据第二行改浅灰圆角块（去 border-b）
- [ ] 3.3 全库复查 `grep -rn "border-b border-border\|border-t border-border" src/`，确认剩余分割线仅剩笔记卡片边框（保留）
- [ ] 门禁：`npm run typecheck`

### 阶段 4：验证

- [ ] 4.1 `npm run typecheck`
- [ ] 4.2 `npm run smoke`、`npm run smoke:stores`、`npm run smoke:decorations`（如存在）
- [ ] 4.3 `npm run ui-smoke`
- [ ] 4.4 `npm run build`
- [ ] 4.5 手动验收（dev 模式）：无分割线视觉、进笔记即编辑、300ms 自动保存（重开验证）、归档只读、切换不弹窗、卡片边框保留

## 验证命令

```bash
npm run typecheck
npm run smoke && npm run smoke:stores && npm run smoke:decorations
npm run ui-smoke
npm run build
```

## 风险文件与回滚点

| 文件 | 风险 | 缓解 |
|---|---|---|
| `NoteView.tsx` | 最大重构面（编辑/保存/草稿全换） | 阶段 2 单独完成并过门禁 |
| `stores/ui.ts` | 删字段编译期全量暴露遗漏 | 1.1 后立即 typecheck |
| `App.tsx` / `ContentHeader.tsx` | 视觉回归 | 低风险，纯 className |

回滚：本任务独立 commit；`git revert` 即可整体回退。

## 开工前检查

- [ ] 用户已批准最终规划总结（Phase 1 gate）
- [ ] `task.py start` 已执行
- [ ] `trellis-before-dev` skill 已加载（frontend 层 spec）
