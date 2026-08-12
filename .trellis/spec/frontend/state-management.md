# State Management

> How state is managed in this project.

---

## Overview

**Zustand 5，按域拆四个 store**（design.md 第 2 节）：

| store | 职责 | 文件 |
|-------|------|------|
| `useUiStore` | 视图/选中项/搜索态/编辑态/排序偏好 | `src/stores/ui.ts` |
| `useObjectsStore` | 对象域（含钉住/归档互斥编排） | `src/stores/objects.ts` |
| `useNotesStore` | 笔记域（AC10 校验） | `src/stores/notes.ts` |
| `useTagsStore` | 标签域（归并语义 + 删除编排） | `src/stores/tags.ts` |

- **db 是唯一事实源，store 是内存投影**：所有写操作"先 db 后内存"（`await dbXxx()` 成功后才 `set()`），不出现内存与 db 不一致窗口
- **启动全量加载**：`bootstrapStores()`（`src/stores/bootstrap.ts:17-31`）一次 `allDocs()` 全量，按类型守卫分区 `hydrate` 三个域；in-flight 共享同一 Promise（幂等），完成后再次调用会重新拉取（uTools 重新进入插件可刷新外部同步数据）
- **表单草稿是**组件本地 state**，不进全局 store（store 只记 `editing: {kind, id}`）；搜索查询文本在 ui store（子输入框驱动，跨组件需要）
- **无未保存确认机制（08-12 起）**：实时保存时代，`ui.ts` 无 pendingDirty/requestRoute；路由切换（selectObject/selectTag/setView/closeNote/startEditing）直接执行、不弹确认框；localStorage 草稿（`sn:draft:*`）已废弃，不得新增依赖
- 无 server state 概念：本地 db 单机，无缓存层/无失效策略

---

## State Categories

- **全局状态（store）**：跨组件共享且会被多处写入 —— 视图、选中项、全量数据、排序偏好。判定标准：两个以上组件读写，或生命周期跨组件（如搜索态在 App 注册、ContentArea 消费、ContentHeader 控制排序）
- **本地状态（useState）**：单组件生命周期内的 UI 细节 —— 表单草稿（NoteForm/ObjectForm/TagInput 的 value）、下拉开关、mode 切换（编辑/预览）
- **派生状态（useMemo / selector 纯函数）**：一切可计算的 —— 排序（`NoteCardList.tsx:211-222`）、标签计数（`countNotesByTag`）、按对象/标签过滤（`selectNotesByObject` / `selectNotesByTag`）、钉住/归档列表（`selectPinnedObjects` 等）
- **无 URL state、无路由**：单窗口插件，视图切换就是 ui store 的 `view` 字段

---

## When to Use Global State

- 数据被 2+ 组件消费且变化会影响它们（对象/笔记/标签全量数据 → store 是唯一选择，因为 db 读是异步的，组件直接读 db 无法响应变更）
- 写操作有跨域副作用（删除标签要清笔记和对象的引用 → 必须走 store action 编排）
- 状态有生命周期语义（搜索态进入/退出要迁移排序偏好，`ui.ts:119-137` setSearch）
- **反之留在本地**：单组件 UI 开关、表单草稿、临时 query。曾评估把 TagInput 的 query 提升到 store，结论是不需要（无跨组件消费）

---

## Server State

不适用（无服务端）。对应的替代机制：

- **bootstrap 全量加载**（`src/stores/bootstrap.ts`）：等价于"缓存预热"，一次拉全量入内存
- **写路径同步**：store action 内 `await db` → `set()`，UI 无需手动刷新（无 stale 窗口）
- **跨 store 一致性编排**（本项目的"事务"替代）：
  - 对象删除：`objects.remove`（`src/stores/objects.ts:69-76`）→ db `deleteObjectCascade`（db 内级联删笔记）→ `useNotesStore.getState().removeByObject()` 同步内存 → 删对象本体
  - 标签删除：`tags.remove`（`src/stores/tags.ts:82-88`）→ `removeTagFromNotes` / `removeTagFromObjects`（各含 db 写）→ `deleteTag` → 内存同步
  - 注意顺序：**先清理引用再删本体**；引用清理失败则整体中断（抛错由调用方处理），不会出现"标签没了引用还在"

---

## 正文实时保存模式（NoteView，08-12）

**契约**：非归档笔记打开即编辑；停止输入 300ms 防抖自动落盘（`updateNote`）；成功静默、失败 toast.error；无手动保存按钮、无确认框。

**并发串行化（关键正确性）**：`db.updateNote` 带旧 `_rev` 的 put 会 conflict，保存必须串行：

```typescript
const draftRef = useRef(draft)        // ref 镜像：定时器回调读最新输入，避免闭包 stale
const saveTimerRef = useRef<number | null>(null)  // 防抖 timer 必须放 ref（hook-guidelines）
const savingRef = useRef(false)       // 保存进行中标志

async function save() {
  if (savingRef.current) return       // 保存中：跳过，由成功后追平兜住
  const latest = useNotesStore.getState().getById(noteId)
  const content = draftRef.current
  if (!latest || content === latest.content) return
  savingRef.current = true
  let ok = false
  try { await updateNote({ ...latest, content }); ok = true }
  catch (err) { toast.error(...) }    // 失败不追平（防无限重试循环）
  finally { savingRef.current = false }
  if (ok && draftRef.current !== content) void save()  // 成功且期间有新输入 → 追平
}
```

**卸载 flush**：卸载时若防抖 pending 且有改动，fire-and-forget 立即保存（`!savingRef.current` 时）；无确认框。

**保存值取 store 最新 note**（`getById(noteId)` 再改 content），保证 `_rev` 最新、避免 conflict。

## Common Mistakes

- **selector 返回新对象导致无限渲染**：selector 必须返回稳定引用或原始值。`useObjectsStore((s) => s.objects.find(...))` 安全（find 返回数组内对象引用）；禁止 `useObjectsStore((s) => s.objects.filter(...))`（每次返回新数组）——需要过滤结果时订阅整个数组再 useMemo，或订阅已导出的 selector（`useObjectsStore(selectPinnedObjects)` 是单参数 selector，Zustand 直接支持，见 `src/components/SidebarList.tsx:77`）
- **跨 store 直接用 setState 而非 action**：域 A 需要改动域 B 的数据时，必须调用 B store 的 action（`useNotesStore.getState().removeByObject(...)`），禁止 `useNotesStore.setState(...)` 裸改
- **AC10 校验只做 UI 层**：必须 store 层 + db 层双保险（见 error-handling.md）
- **把 sort/sourceFilter 放组件本地**：排序偏好是跨视图保留的全局状态（`ui.ts` 注释：切视图不清空，smoke-stores `[9]` 有断言），放本地会导致切换视图丢失偏好
- **bootstrap 重复并发**：`bootstrapStores()` 未做 in-flight 去重时 React StrictMode 下会双拉；现在 `inflight` 共享（`src/stores/bootstrap.ts:13-30`，hydrate 注入在 22-24）
