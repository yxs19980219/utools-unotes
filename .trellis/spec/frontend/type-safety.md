# Type Safety

> Type safety patterns in this project.

---

## Overview

TypeScript（strict，`tsc -b` 门禁）+ **schema v1 单类型源**：全部领域类型定义在 `src/types.ts`，db 层/服务层/store/组件共享，无重复定义。

- 无运行时校验库（无 Zod 等）：utools.db 是本地可信数据，运行时收窄靠**类型守卫**（见 Validation）
- 时间戳为 `number`（`Date.now()`），_id 为字符串（`object/<uuid>` / `note/<uuid>` / `tag/<slug>` / `setting/<key>`）
- 标签/笔记/对象的 `tags` 字段类型是 `string[]`（canonical tagId），**不是** Tag 对象数组——引用语义贯穿全层
- uTools 全局对象类型来自 `utools-api-types` 包（`typeof utools` 在 db.ts 顶部判定可用性，无类型报错）

---

## Type Organization

- `src/types.ts`（唯一 schema 源）：`NoteObject` / `Note` / `Tag` / `Setting` / `SourceType` / `SourceMeta` + 输入类型 `NoteObjectInput` / `NoteInput`（不含系统字段 `_id`/时间戳）+ 常量 `SETTING_KEYS` / `BUILTIN_SOURCE_TYPES` + `SearchSort`
- `src/services/db.ts`：`DbDoc`（`{ _id: string; _rev?: string }`，所有文档的公共基类）、`DbResult`（put/remove 返回）、`DbAdapter` 接口（双实现契约）
- `src/services/search.ts`：`SearchContext` / `SearchResult`（`search.ts:17-29`）/ `SearchTokens`（搜索层专有类型，随函数导出）
- `src/stores/ui.ts`：`View` / `SearchState` / `EditingState`（UI 状态类型，store 文件内定义）
- 组件 props 类型：文件内联 interface（就近原则）；跨组件共享的显示类型（如 `TagChip` 的 props）随组件导出
- **派生 selector 类型**：`src/stores/notes.ts:101-109` 等，签名 `(s: NotesState, ...args) => Note[]`，组件内 `useNotesStore((s) => selectNotesByObject(s, id))` 组合

---

## Validation

无 schema 校验库。运行时收窄靠 **db.ts 层的四个类型守卫**（唯一收窄入口，跨层指南：消费方禁止自行收窄）：

```ts
// src/services/db.ts:135-145
isNoteDoc(d)   // note/ 前缀 + objectId 是 string
isObjectDoc(d) // object/ 前缀 + sourceType 是 string
isTagDoc(d)    // tag/ 前缀 + name 是 string
isSettingDoc(d)// setting/ 前缀
```

- 守卫是**前缀 + 关键字段双条件**（防误收窄：如手滑写入 object/ 前缀的文档）
- 消费方（bootstrap、list 函数）一律 `docs.filter(isNoteDoc)`，禁止内联 `d._id.startsWith` 或 `as Note` 断言
- `getX(id)` 系列返回 `X | null`：`db.get` 可能 miss，且守卫可能判 false（类型不对的文档返回 null 而非崩溃）
- 输入校验（业务规则）在 store/服务层以 throw 表达（AC10 见 error-handling.md），不做类型层校验

---

## Common Patterns

- **类型守卫 + 窄化**：`isNoteDoc` 等是 `d is Note` 类型谓词；`bootstrap.ts:22-24` 用 `docs.filter(isObjectDoc)` 获得 `NoteObject[]`
- **`_rev` 可选**：`_rev?: string` —— 新建文档无 _rev；更新必须带（db 层容错：缺 _rev 时先 `get` 补齐，`db.ts:194-198` updateObject）
- **输入类型与实体类型分离**：`NoteObjectInput`（无 `_id`/`createdAt`/`archived`）→ 实体由 `createObject` 补齐系统字段（`db.ts:177-192`）；组件不手拼系统字段
- **展示层投影类型**：`SearchResult`（`search.ts:22-28`）携带 `object: NoteObject | null`（孤儿笔记兜底 null）与 `tagMatches: string[]`、`score`，UI 直接消费不重算
- **`as const` 常量对象**：`SETTING_KEYS`（`types.ts:90`）、`ID_PREFIX`（`db.ts:26`）——跨层契约常量，杜绝魔法字符串
- **类型窄化过滤**：`tagChips = note.tags.map(id => tagById.get(id)).filter((t): t is Tag => !!t)`（`NoteCardList.tsx:69-71`），用类型谓词过滤 undefined

---

## Forbidden Patterns

- **`as` 断言收窄 DbDoc**：除 db.ts 守卫内部外，全项目禁止 `(d as Note)` / `as any`；收窄一律走守卫
- **组件内联 `d._id.startsWith('note/')`**：前缀判断只在 `ID_PREFIX` + 守卫内出现
- **裸 `any`**：`DbDoc` 是未知文档的收敛类型；`Setting.value` 是 `unknown`（`types.ts:75`），消费方用 `Array.isArray` 等窄化（如 `db.ts:305-312` getSourceTypes）
- **重复定义 schema 类型**：新字段先改 `types.ts`，禁止在服务层/组件另建同名 interface
- **`string | null` 与 `undefined` 混用**：store 选中项统一 `string | null`（`ui.ts`），get 系列统一 `T | null`
