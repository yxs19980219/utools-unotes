# Hook Guidelines

> How hooks are used in this project.

---

## Overview

**本项目无自定义 hooks**（无 `useXxx` 自定义 hook 文件）。数据获取不经过任何 fetch 库：状态全量在内存（Zustand store，启动 bootstrap 一次载入），组件用 `useStore(selector)` 订阅；派生数据一律内联 `useMemo`。规则总结：

- 共享状态 → Zustand store（selector 订阅，不是 Context 不是自定义 hook）
- 派生数据 → 组件内联 `useMemo`（依赖数组必须齐全）
- uTools 平台事件（onPluginEnter / setSubInput / 暗色切换）→ 顶层 `useEffect` 一次性注册
- 轻量异步读（来源类型枚举）→ 唯一"类 hook"：`useSourceTypes`（`src/lib/sourceTypes.ts:44`，模块级缓存 + useState/useEffect），二期设置域接入 store 后移除

---

## Custom Hook Patterns

不适用 —— 无自定义 hooks。**不要为了复用而造 hook**：多个组件订阅同一 store 已是共享机制（如 `useUiStore` 在 ContentArea/ContentHeader/SidebarList 各自订阅）。若发现三处以上重复的 selector + useMemo 组合，优先提取为 store 文件的派生 selector 纯函数（如 `selectPinnedObjects`），而不是自定义 hook。

唯一的 hook 形态是 **store 订阅 hook**（Zustand 生成）：`useObjectsStore((s) => s.objects.find((o) => o._id === id))`（`src/components/ObjectDetail.tsx:36`）。selector 内允许 find/filter（返回值是引用，变化时才重渲染）。

---

## Data Fetching

无网络请求、无 React Query/SWR。数据流是**启动一次全量加载 + 内存同步**：

1. `src/App.tsx:28` 挂载时 `bootstrapStores()` → `allDocs()` 一次全量 → 三域 hydrate（`src/stores/bootstrap.ts:22-24`）
2. 之后所有写操作经 store action：先写 db（`services/db.ts`），成功后 `set()` 更新内存（如 `src/stores/notes.ts:52-62` create）
3. 读取方零 async：组件订阅内存数组，派生用 useMemo

异步读取模式（少见的 db 读）：`useSourceTypes` 模块级缓存 —— `cached` 变量 + 首次挂载 useEffect 拉取，跨组件共享同一份，避免重复读 db。

---

## Naming Conventions

- 所有 hook 调用遵循 `use` 前缀：React 内置（`useState`/`useMemo`/`useEffect`/`useRef`）+ Zustand 生成的 store hook（`useUiStore`/`useObjectsStore`/`useNotesStore`/`useTagsStore`）+ `useSourceTypes`
- 禁止命名自定义 hook 的文件（本项目不建 `hooks/` 目录）；"hook 化"的复用诉求先评估 store selector / lib 纯函数
- `useMemo` 回调内禁止副作用；依赖数组必须含全部闭包变量（`useMemo` 依赖 `[notes, sort, presorted]` 例见 `src/components/NoteCardList.tsx:211-222`）

---

## Common Mistakes

- **useEffect 依赖数组写死导致 stale 闭包**：`NoteForm.tsx:121-133` 的 Ctrl+S window 监听**故意不用依赖数组**（每次渲染重挂，回调永远最新），并用 `e.target.closest('.cm-editor')` 跳过 CodeMirror 内部事件避免重复保存；CodeMirror 内保存由 keymap 的 `saveRef` 模式处理（`src/components/Editor/CodeMirrorEditor.tsx:55-75`：useRef 存最新回调，keymap 用 useMemo 固定引用不重建）——两处是**同一需求（Ctrl+S）的两种互补实现**，改一处必须同步另一处
- **每次输入触发编辑器 reconfigure**：`CodeMirrorEditor.tsx:58` extensions/basicSetup 用 useMemo 固定引用（@uiw 的 reconfigure effect 依赖这些引用）
- **派生列表每次渲染重算**：计数/筛选/排序必须 useMemo；若依赖对象是 store 数组，选择器返回值引用稳定即可（`src/components/SidebarList.tsx:151-153` 的 counts/sorted）
- **在 useMemo 里写副作用 / 在 useEffect 里 setState 循环**：数据变换全在 useMemo，事件注册全在 useEffect，两者互不借用
- **事件防抖用 ref 存 timer**：`App.tsx:37-52` 子输入框 200ms 防抖，timer 存 `useRef<number>`，组件卸载时清理；禁止把 timer 放进 state（会触发重渲染）
