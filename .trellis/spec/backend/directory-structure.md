# Directory Structure

> How backend code is organized in this project.

---

## Overview

本项目**无后端服务**（纯前端 uTools 插件，无服务器/无 API 端点/无独立后端包）。持久化与"服务端"职责由渲染进程内的数据层承担：`src/services/` + `src/stores/` + `src/types.ts`。

数据层约定与布局详见：

- `backend/database-guidelines.md` —— utools.db 封装（`src/services/db.ts`）的 _id 前缀、_rev、DbAdapter 双实现、级联删除与红线
- `backend/error-handling.md` —— assertOk / not_found 幂等 / AC10 双保险 / AlertDialog 确认
- `frontend/state-management.md` —— store 编排与跨 store 一致性（"服务端事务"的替代机制）

---

## Directory Layout

```
src/
  services/    # 数据层：db.ts（唯一 db 写入口）、tagNormalize.ts、search.ts
  stores/      # 内存投影 + 跨域一致性编排（objects/notes/tags/ui/bootstrap）
  types.ts     # schema v1 全类型契约（前后端共享的"数据契约"）
scripts/       # node 直测冒烟测试（MemoryDb 降级，无 uTools 环境）
```

---

## Module Organization

不适用（无后端模块）。新增"后端逻辑"的落位规则：db 读写 → `services/`；编排/校验 → `stores/`；纯类型 → `types.ts`（详见 frontend/directory-structure.md 的 Module Organization）。

---

## Naming Conventions

不适用（无后端）。数据层命名沿用领域函数约定：`getX` / `listX` / `createX` / `updateX` / `deleteX`（见 database-guidelines.md）。

---

## Examples

无后端示例。数据层参考实现：`src/services/db.ts`（适配器 + 守卫 + 领域 CRUD）、`src/services/search.ts`（纯内存搜索）。
