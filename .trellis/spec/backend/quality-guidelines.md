# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

**本项目无后端服务，本文件不适用**。数据层（`src/services/`）的质量标准与门禁见：

- `frontend/quality-guidelines.md` —— 冒烟测试体系（`npm run smoke` / `smoke:stores` / `smoke:decorations`）、typecheck/build 门禁、`scripts/` node 直测模式与 MemoryDb 防御
- `backend/database-guidelines.md` —— utools.db 约定与红线（唯一写入口、_id 前缀、_rev、不落索引/缓存）
- `backend/error-handling.md` —— assertOk / not_found 幂等 / AC10 双保险

---

## Forbidden Patterns

不适用（无后端）。数据层红线见 database-guidelines.md 的 Common Mistakes。

---

## Required Patterns

不适用（无后端）。数据层必守模式见 database-guidelines.md 与 frontend/quality-guidelines.md。

---

## Testing Requirements

数据层测试即前端冒烟体系的一部分：`scripts/smoke-data-layer.ts`（schema 往返 / _rev 冲突 / 级联删除 / 别名归并 / 搜索语法 / AC9）、`scripts/smoke-stores.ts`（store 编排一致性）。新增数据层契约必须配套断言（见 frontend/quality-guidelines.md Testing Requirements）。

---

## Code Review Checklist

不适用（无后端）。数据层评审项并入前端 checklist（frontend/quality-guidelines.md Code Review Checklist）。
