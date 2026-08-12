# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

本项目无后端服务/无 ORM。数据层是 **utools.db**（uTools 内置文档型本地数据库，CouchDB 风格，自带跨设备同步），封装在 `src/services/db.ts` —— **全项目唯一 db 写入口**。UI 组件不直接碰 db（红线），一律经 store → services/db.ts。

关键事实（来自代码，`src/services/db.ts`）：

- 全部走 **promises API**（`utools.db.promises.put/get/remove/allDocs`），无回调 API
- 更新必须带 `_rev`（不带会 conflict）；`_id` 前缀分类：`object/`、`note/`、`tag/`、`setting/`
- **DbAdapter 双实现**：uTools 环境用 `UtoolsDb`（真实 API），无环境（node 冒烟测试 / 浏览器调试）降级 `MemoryDb`（`db.ts:72-101`，行为对齐真实 API：缺 _rev 的更新返回 conflict、删不存在的 id 返回 not_found）
- 数据模型契约（schema v1）见 `src/types.ts`；类型守卫是本层唯一收窄入口（type-safety.md）

---

## Query Patterns

- **全量加载**：启动一次 `allDocs()` 全量入内存（`src/stores/bootstrap.ts`），之后内存过滤；量级千条内毫秒级（design.md 权衡记录）
- **前缀过滤**：`allDocs(idStartsWith)` 按前缀取域（`db.ts:172-175` listObjects 等）
- **单条读取**：`get(id)` → 守卫校验 → `T | null`（`db.ts:167-170` getObject）
- **写路径统一 putDoc**：`put` → `assertOk` → 返回带新 `_rev` 的文档（`db.ts:152-155`），调用方用返回值更新内存，不二次读库
- **无批量写**：删除标签的引用清理是逐个 `update` 循环（`Promise.all`，`src/stores/notes.ts:83-93`），量小可接受，不引入事务
- **级联删除**：`deleteObjectCascade`（`db.ts:200-206`）先删对象下全部笔记再删对象本体，返回删除的笔记数（UI 确认框用）；幂等容错见 error-handling.md

---

## Migrations

无迁移框架。约定（design.md 第 7 节"数据演进"）：

- **schema 字段全部可选缺省兜底**：老文档读取容错（如 `Tag.pinned` 是 schema v1.1 增量，`types.ts:67` 注释：老文档缺省 undefined 等价 false）
- **设置文档按 key 约定结构**：`setting/<key>` + `value` 字段（`Setting` 类型），读取方自行窄化（`getSourceTypes` 用 `Array.isArray` 校验，`db.ts:305-312`；非法值回退内置枚举）
- v1 内无迁移需求；二期（归档/设置）仅新增视图与 setting 文档，不加字段（design.md 第 7 节）

---

## Naming Conventions

- **_id 前缀分类**（跨层契约，消费方不得硬编码）：`ID_PREFIX` 常量（`db.ts:26-31`）
  - `object/<uuid>`（对象，crypto.randomUUID）
  - `note/<uuid>`（笔记）
  - `tag/<slug>`（标签，slug 冲突加 `-2/-3` 后缀，`buildTagId` 在 `tagNormalize.ts:62-70`）
  - `setting/<key>`（设置）
- **时间戳 `number`**（`Date.now()`）：`createdAt` / `updatedAt`（写路径统一 `now()`）
- **引用存 id 不存名称**：笔记/对象的 `tags: string[]` 存 canonical tagId → 标签重命名/别名编辑 O(1)，不遍历（design.md 第 3 节关键契约）；删除标签才遍历清理（`notes.ts:83-93` removeTagFromNotes）
- 领域函数命名：`getX` / `listX` / `createX` / `updateX` / `deleteX`（`getObject`/`listObjects`/`createObject`/`updateObject`/`deleteObjectCascade`）

---

## Common Mistakes

- **更新不带 `_rev`**：会 conflict；`updateX` 已做容错（缺 rev 先 get 补齐，`db.ts:194-198`），但显式携带是默认写法；MemoryDb 对缺 rev 的更新返回 `{ error: true, name: 'conflict' }` 以便测试捕获
- **把缓存/索引写入 db**：红线。搜索索引是内存态，绝不落库；db 只存用户主动创建的数据（design.md 第 4 节）
- **在 UI 层直接调 utools.db**：破坏分层，且 node 冒烟测试无法覆盖；一律经 store → db.ts
- **组件收窄 DbDoc**：类型守卫是本层唯一契约 owner，消费方 `filter(isNoteDoc)` 而非内联断言
- **`allDocs()` 不带前缀全量使用后又自己过滤**：域读取必须用 `ID_PREFIX.x` 前缀参数（利用索引），守卫只作第二道防线
- **设置文档 value 不做窄化**：`getSourceTypes` 的反例教训 —— value 是 `unknown`，必须先 `Array.isArray` 校验再 cast，非法数据回退默认值
