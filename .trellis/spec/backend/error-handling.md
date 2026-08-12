# Error Handling

> How errors are handled in this project.

---

## Overview

本项目无后端服务/无 API 层；错误处理分三层，语义自上而下收拢：

```
UI 层     AlertDialog 确认 + toast 反馈（sonner）→ 用户可见的最终边界
store 层  action 抛错（业务规则，如 AC10）→ 调用方（表单）catch → toast
db 层     assertOk 抛错（db 故障/冲突）+ not_found 幂等容错 → 冒烟测试断言
```

- **无自定义 Error 类**：`Error` + 中文 message 足够（message 直接进 toast，`NoteForm.tsx:113` `toast.error(\`保存失败：${err.message}\`)`）
- **无日志库、无全局错误边界**：错误要么被表单 catch 转 toast，要么在冒烟测试中 assert
- 冒烟测试的失败出口：`main().catch(err => { console.error('SMOKE FAILED:', err); process.exit(1) })`（scripts 各文件尾部）

---

## Error Types

无自定义错误类型。三类错误语义：

| 场景 | 形式 | 例子 |
|------|------|------|
| db 操作失败/冲突 | `assertOk` 抛 `Error('db <name>: <message>')` | `src/services/db.ts:125-128` |
| 业务规则（不可恢复输入） | store action 抛 `Error('中文提示')` | `src/stores/notes.ts:53-58` AC10 |
| 不存在的实体 | 返回 `null`/空列表，不抛错 | `getX` 系列、`getById` |

---

## Error Handling Patterns

- **db 层 `assertOk`**（`db.ts:125-128`）：`put/remove` 返回的 `DbResult.ok` 为 false 即抛错；message 由 uTools 返回（如 conflict）
- **`not_found` 幂等容错**（`db.ts:158-163` removeById）：删除不存在的 id 视为成功（级联删除重试不抛错）——**删除必须是幂等的**；其余错误（conflict 等）照常抛出
- **store 层 AC10 双保险**（`src/stores/notes.ts:52-58`）：`create` 前先 `getObject(input.objectId)` 以 db 为事实源校验（不依赖内存加载时序），不存在则抛 `'笔记必须归属一个存在的对象（AC10）'`；UI 表单侧另有禁用 + 强提示（`NoteForm.tsx:84-85` noObject + 红字提示）
- **表单提交错误**：`try/catch/finally` 包裹，catch 转 `toast.error`，finally 复位 `saving`（`NoteForm.tsx:87-115`）；异步写操作失败的 UI 状态与 store 内存均不回滚（db 失败即内存未 set，天然一致）
- **孤儿引用兜底**：笔记的对象已删除（外部同步异常）时，消费方窄化为 `null` 不崩溃（`SearchResult.object: NoteObject | null`，`search.ts:24-28`；`NoteCardList` 的 `objectById.get(...) ?? null`）
- **空查询/无匹配**：搜索返回 `[]` 不抛错（`search.ts:73-81`），UI 显示语法提示空态（`ContentArea.tsx:83-103`）

---

## API Error Responses

不适用（无 API）。对应物是 db 层返回契约：

- `DbResult`（`db.ts:33-39`）：`{ id, rev?, ok?, error?, name?, message? }` —— 成功 `ok: true`，失败 `error: true` + `name`（`conflict` / `not_found`）+ `message`
- 冒烟测试断言该契约：`_rev` 冲突返回 conflict、缺 `_rev` 更新拒绝、删除不存在 id 返回 not_found（`scripts/smoke-data-layer.ts`）

---

## Common Mistakes

- **删除非幂等**：删除前先 `get` 判断存在再删 → 级联中途失败重试会误报；正确做法是 `removeById` 直接删 + not_found 吞掉
- **UI 层吞掉 db 错误**：catch 后只 console.log 不给用户反馈；本项目约定 toast 必须出现（保存失败/创建标签失败 `TagInput.tsx:96-100`）
- **AC10 只校验 UI 禁用按钮**：按钮禁用是 UX，数据层校验是契约；绕过 UI 的调用（冒烟测试/未来入口）必须被 store 层拦下
- **破坏性操作无确认直接执行**：删除对象/笔记/标签一律 AlertDialog 确认（提示级联数量，`ObjectDetail.tsx:105-133`、`NoteCardList.tsx:107-135`、`TagRowActions.tsx`）；确认后才调 store action
- **用 try/catch 兜业务预期**：业务规则用 if + throw 表达（可读、可冒烟断言），try/catch 只包 db 边界
