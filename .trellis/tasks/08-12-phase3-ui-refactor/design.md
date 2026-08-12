# SourceNote 三期技术设计：对象一维状态 + 视图顶栏统一

基于二期代码现状（v1.1.0，`main` 分支）。核心变更：① objects 域去 pinned 维度；② ContentHeader 按语境渲染唯一顶栏（对象详情/标签/搜索/空态）；③ 侧边栏对象行 ContextMenu；④ 对象标签去除。

## 1. 状态模型一维化（objects 域）

```
二期：pinned ✕ archived 两维正交（互斥靠编排维持，恢复后出现"活跃但隐身"态）
三期：archived 一维；活跃 = !archived 即展示
```

- `src/stores/objects.ts`：
  - 删除 `togglePinned` action；`create` 不再默认 pinned
  - `setArchived(objectId, archived)`：直接 `update({ ...obj, archived })`（去掉 pinned 联动）
  - 删除 `selectPinnedObjects`；首页活跃列表 = `selectActiveObjects`（已存在）+ 调用方按 updatedAt 倒序
  - `NoteObject.pinned` 字段保留在 types（schema 兼容，不读写；避免迁移）
- `src/stores/tags.ts`：`selectPinnedTags` / `togglePinned`（标签）**保留**（R2 决策：标签钉住是主题维度）
- 消费方排查（一期遗留 pinned 依赖）：
  - `SidebarList.tsx` HomeSidebarGroups：pinnedObjects → 活跃对象列表
  - `ObjectDetail.tsx`：钉住按钮删除
  - `NoteForm.tsx` `activeObjects`：已过滤 !archived，不变
  - smoke-stores `[3]` 钉住/归档断言改写

## 2. ContentHeader 语境化渲染（核心架构变更）

现状 ContentHeader 只推导标题 + 全局统一操作区（排序/新建/搜索）；ObjectDetail 自带元数据条 + 列表标题行 → 三层。重构后 **ContentHeader 是唯一顶栏**，按语境渲染（订阅 ui store 选中态 + objects store 对象）：

```
语境矩阵：
┌───────────────┬────────────────────────────────┬──────────────────┐
│ 语境           │ 标题行                         │ 操作区            │
├───────────────┼────────────────────────────────┼──────────────────┤
│ editing       │ 表单标题（现状）                 │ 无（现状）         │
│ searchActive  │ 搜索结果                       │ 排序▾ + 来源筛选▾  │
│ selectedObject│ 来源Badge+标题+笔记N            │ 排序▾＋新笔记       │
│  (活跃)        │ 第二行：作者·年份·URL           │ 归档 编辑 删除     │
│ selectedObject│ 来源Badge+标题+笔记N+已归档Badge │ 排序▾ 恢复         │
│  (归档/readonly) 第二行：作者·年份·URL          │                   │
│ selectedTag   │ 标签名                         │ 排序▾ + 来源筛选▾  │
│ view 空态     │ 视图名（首页/标签/归档/设置）     │ 无                │
└───────────────┴────────────────────────────────┴──────────────────┘
```

- 顶栏高度：默认 `h-11`；对象详情语境有元数据时第二行（`text-xs` 小字，h-8）——header 内部两行布局（flex-col），总高约 h-11+h-8，其余视图单行
- 笔记数来源：`selectNotesByObject` 长度（对象详情语境订阅）
- 操作按钮复用二期 ObjectDetail 的 AlertDialog 逻辑（归档/删除确认移入 ContentHeader；归档/恢复 toast 保留）
- ObjectDetail 组件瘦身为纯卡片流：删除元数据条 + 列表标题行 + 操作按钮（只保留「对象不存在」空态兜底）
- 归档对象判定：`selectedObjectId` → object.archived（readonly 分支）

## 3. 侧边栏对象行 ContextMenu（右键）

- 新增 shadcn `src/components/ui/context-menu.tsx`（radix-ui 一体化包已含 `@radix-ui/react-context-menu@2.3.7`，按 shadcn 标准实现，与项目 ui 组件风格一致）
- `SidebarList` 对象行（活跃/归档两处）：`ContextMenu` 包裹 SidebarRow：
  - 活跃对象：编辑 / 归档 / 删除
  - 归档对象：恢复 / 删除
- 菜单项内触发 AlertDialog：**受控 AlertDialog**（`open` state 提升到行组件，菜单项 onSelect → setDialogOpen(true)，不用 AlertDialogTrigger——避免 Menu 与 Dialog 焦点冲突）
- 删除确认需笔记计数：从 notes store `selectNotesByObject` 长度取（同步，免异步）
- 空态/无右键：SidebarRow 点击行为不变（左键选中）

## 4. 对象标签去除（R10）

- `ObjectForm.tsx`：删除 TagInput + `resolveTagIds` 调用（提交只含 title/sourceType/sourceMeta）
- `ObjectDetail.tsx`：删除标签 chips 渲染（第二行仅作者/URL/年份）
- 兼容：`objects.removeTagFromObjects`（tags 域删除标签时清理对象引用）保留——旧数据可能残留对象标签，清理逻辑无害且必要
- `types.ts` NoteObject.tags 字段保留（schema 兼容，新对象写 `[]`）

## 5. 新建入口收敛

```
删除：ContentHeader「新建▾」下拉（note/object 两项）
新增：SidebarList「活跃对象」分组标题右侧 + 按钮（icon-sm，Tooltip「新建对象」）→ startEditing('object', null)
保留：ObjectDetail 语境顶栏「＋新笔记」→ startEditing('note', null)（NoteForm 预填当前对象）
防御：NoteForm 无上下文兜底对象选择逻辑保留（入口已杜绝，代码不删）
```

- ContentHeader 删除「新建▾」与搜索按钮（`subInputFocus` 调用删除；`App.tsx` 的 `utools.setSubInput` 注册保留）
- 空态 CTA（首页无活跃对象「新建对象」按钮）保留

## 6. 文件改动清单

| 文件 | 改动 |
|------|------|
| `src/stores/objects.ts` | 删 togglePinned/selectPinnedObjects；create 去默认钉住；setArchived 去联动 |
| `src/components/ui/context-menu.tsx` | 新增（shadcn 标准，radix context-menu） |
| `src/components/SidebarList.tsx` | 活跃对象分组 + 标题 + 按钮；对象行 ContextMenu（编辑/归档/删除；归档行恢复/删除） |
| `src/components/ContentHeader.tsx` | 语境化渲染矩阵；删新建▾/搜索按钮；对象详情操作区 + 元数据第二行 |
| `src/components/ObjectDetail.tsx` | 瘦身：删元数据条/列表行/操作按钮，仅卡片流 + 不存在兜底 |
| `src/components/ObjectForm.tsx` | 删标签输入与 resolveTagIds |
| `src/components/NoteView.tsx` | 顶栏删对象名链接（其余保留） |
| `scripts/smoke-stores.ts` | [3] 钉住断言改写为一维状态断言；[11] 等受影响处核查 |
| `scripts/ui-smoke.mjs` | 更新对象创建/钉住断言为活跃列表断言；新增右键菜单/新建入口断言 |
| `src/stores/ui.ts` | 无改动（确认 requestRoute 等不受影响） |

## 7. 风险与权衡

| 风险 | 缓解 |
|------|------|
| ContextMenu 与 AlertDialog 嵌套焦点冲突 | 受控 AlertDialog（state 提升），不用 trigger 嵌套 |
| 右键菜单不可发现 | 左键点击选中不变；空态 CTA 兜底（用户决策：不加悬停 ⋯） |
| ContentHeader 变重（对象详情订阅对象+笔记数） | 订阅粒度小（单对象 find + selectNotesByObject 长度）；header 高度两行仅对象详情语境 |
| 去 pinned 后首页列表变长 | ScrollArea 已有；个人笔记量级可接受（用户拍板） |
| 旧数据 pinned/对象 tags 残留 | 字段保留不读写；removeTagFromObjects 保留兼容 |
| 二期草稿拦截（requestRoute）与右键菜单交互 | 菜单项 onSelect 不触发路由（编辑/归档走 startEditing/setArchived 已有拦截语义）——编辑项走 requestRoute |

## 8. 验收映射

AC1-AC12 与 prd.md 一致；渲染层门禁：`npm run ui-smoke`（800×600 viewport）必须覆盖新入口与右键流程断言。
