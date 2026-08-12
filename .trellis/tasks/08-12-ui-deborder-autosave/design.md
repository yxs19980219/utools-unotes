# Design — UI 去分割线改造 + 笔记实时保存链路简化

## 1. 架构与边界

改动全部在 frontend 层（组件 + ui store），db 层契约不变。

```
┌───────────────────────┬──────────────────────────┐
│ aside bg-sidebar 浅灰  │ main bg-background 纯白   │  ← 去 border-r（R1）
│  ViewSwitcher          │  ContentHeader           │  ← 去 border-b（R2）
│  SidebarList           │  ├─ 对象详情：标题行       │
│                        │  └─ 元数据浅灰圆角块(R3)  │
│                        │  ContentArea             │
│                        │  └─ NoteView             │  ← 进即编辑+实时保存
└───────────────────────┴──────────────────────────┘
```

## 2. 去分割线改动点（均为纯 className 修改，无逻辑变更）

| 文件 | 行 | 改动 |
|---|---|---|
| `App.tsx` | 60 | `aside`：`border-r border-border` → `bg-sidebar` |
| `ContentHeader.tsx` | 159, 306, 323 | 三处顶栏 `border-b border-border` → 去掉 |
| `ContentHeader.tsx` | 234-261 | 元数据第二行 → 圆角浅灰块：`flex ... bg-muted/50 rounded-md px-2.5 py-1.5`，去 `border-b` |
| `NoteView.tsx` | 189 | 工具行去 `border-b` |
| `NoteForm.tsx` | 250 | 底部操作栏 `border-t` → `bg-muted/50` |
| `ObjectForm.tsx` | 148 | 同上 |
| `NoteCardList.tsx` | 90 | 不动（保留边框 R4） |

侧边栏内部：SidebarRow 已有 `hover:bg-muted` / `data-[selected=true]:bg-accent`，无需改。

## 3. 实时保存设计（NoteView 重构）

### 3.1 状态机

```
打开笔记（非归档）→ editingActive = true（无条件，删 editingBody）
  draft state = note.content
  输入 → onChange 置 draft
  300ms 防抖 → save() → updateNote({...最新note, content: draft})
  成功：静默（无 toast）；store 更新 note → dirty 判定自然消失
  失败：toast.error('保存失败：…')；内容保留在 draft（不丢）
归档笔记 → 只读 MarkdownView（现状 readonly 分支保留）
```

### 3.2 并发防抖的串行化（关键正确性）

`db.updateNote`（`db.ts:235`）缺 `_rev` 时读库补齐，但**带旧 `_rev` 的 put 会 conflict**。300ms 间隔下两次 put 重叠的可能性低，但不能排除：

- 方案：`savingRef` + `pendingSaveRef` 双标志
  - 保存进行中若 draft 又有变化 → 置 `pendingSaveRef`，当前保存完成后若 `pendingSaveRef` 且 draft ≠ 已保存值，立即再保存（循环追平）
- 保存时以 `useNotesStore.getState().getById(noteId)` 取最新 note（保证 `_rev` 最新）再写入 content
- 简单、无队列、无额外抽象，符合"不搞预防性抽象"

### 3.3 卸载（路由切换）

- 卸载时：若有未落盘的防抖 pending，**立即 flush 一次保存**（不用 await，fire-and-forget；保存失败 toast 已在组件卸载后不可见——可接受，300ms 窗口极小，且用户已拍板不兜底）
- 无确认弹窗（DirtyGuard 已删）

### 3.4 其他

- Ctrl+S：CodeMirrorEditor 的 `onSave` 保留 → 立即 flush（清防抖定时器 + 立即保存）
- 成功 toast 删除（每 300ms 弹一次不可接受）；「已保存」状态指示不做（保持简洁，用户拍板静默）
- updatedAt 随每次保存刷新 → 「最近更新」排序自然上浮，符合预期
- 编辑态顶部元信息行（R13）：标签 chips + 「更新于 xx」小字，`flex flex-wrap gap-1.5 px-3 pt-2`，无边框（复用现有只读态的 TagChip 渲染，从只读分支上移到共用位置）
- 只读态（归档）保留：标签 + 时间 + MarkdownView

## 4. DirtyGuard 机制删除清单

### 4.1 `stores/ui.ts`

删除字段/方法：`pendingDirty`、`dirtyRoute`、`dirtyOnDiscard`、`setPendingDirty`、`requestRoute`、`cancelRoute`、`discardDirty`。
保留：`applyPrefs`、`setView/selectObject/selectTag/openNote/closeNote/setSearch/startEditing/stopEditing`（setView 等内部实现不含 requestRoute，无需改）。

### 4.2 调用点替换（requestRoute(() => X) → X）

| 文件 | 行 | 替换 |
|---|---|---|
| `ContentHeader.tsx` | 197, 215 | `startEditing('note', null)` / `startEditing('object', objectId)` |
| `NoteCardList.tsx` | 86, 88, 103 | `openNote(note._id)` ×2、`startEditing('note', note._id)` |
| `NoteView.tsx` | 190 | `closeNote()` |
| `SidebarList.tsx` | 183, 268, 287, 306, 319, 364, 376, 409 | 对应 `startEditing/selectObject/selectTag` |
| `ViewSwitcher.tsx` | 26 | `setView(v as View)` |

### 4.3 文件与组件

- 删除 `src/components/DirtyGuard.tsx`；`App.tsx` 移除 import 与 `<DirtyGuard />`
- `NoteForm.tsx`：删 `setPendingDirty` 引用、dirty 计算、两个 effect、handleCancel 中的清理（表单底部栏样式按 R5 改）
- `NoteView.tsx`：删草稿机制（readDraft/writeDraft/clearDraft/DRAFT_PREFIX/draftKey）、dirty effect、setPendingDirty 引用、editingBody/enterEdit/cancelEdit/saveBody 的按钮路径 → 重构为 3.1 状态机

## 5. 兼容性与回滚

- 无数据迁移：db 契约不变；localStorage 草稿键 `sn:draft:*` 残留无害（旧数据不读不写，留作自然清理）
- 回滚点：本任务独立 commit；若实时保存出现数据问题，`git revert` 该 commit 即恢复手动保存链路（DirtyGuard 机制整体复原）
- 风险文件：`NoteView.tsx`（最大重构面，编辑路径全换）、`stores/ui.ts`（删字段影响面广，编译期可查）

## 6. 权衡记录

- 静默保存 vs 每次 toast：实时保存下 toast 是噪音；失败提示足够
- 300ms vs 更短：低于 300ms 会在打字停顿间隙频繁写盘（输入法候选词停顿也算停顿），300ms 平衡实时性与写盘频率
- 删草稿机制 vs 保留：实时保存使草稿窗口缩至毫秒级，localStorage 草稿成为冗余双写；删
- 编辑态显示标签/时间 vs 不显示：编辑时看不到标签会导致"切出去看标签再切回来"，一行小字成本极低
