# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

质量门禁（package.json scripts）：

```bash
npm run typecheck        # tsc -b（build 也会先跑）
npm run build            # tsc -b && vite build → dist/（检查无 development 字段）
npm run smoke            # node scripts/smoke-data-layer.ts（数据层 + 搜索）
npm run smoke:stores     # node scripts/smoke-stores.ts（store 编排 + 一致性）
npm run smoke:decorations# node scripts/smoke-decorations.ts（编辑器装饰器，headless）
```

无 lint（未配置 ESLint）、无单测框架 —— **冒烟测试体系替代单测**：node 直测（无 uTools 环境），覆盖关键契约，跑全部通过即视为可交付。原则：不为展示层写测试（变更频繁收益低），为**数据契约与跨 store 编排**写冒烟（回归收益高）。

---

## Forbidden Patterns

- **组件/UI 层直接读写 utools.db**：数据必须经 store → services/db.ts；这是本项目最高红线
- **把搜索索引/缓存写入 db**：搜索是内存全量过滤，db 只存用户主动创建的数据（design.md 第 4 节红线）
- **不经过 store 裸改内存**：`useNotesStore.setState(...)` 直接改数组、绕过 action 编排（级联清理会漏）
- **硬编码 `_id` 前缀字符串**：用 `ID_PREFIX`（`db.ts:26`）；硬编码会导致类型守卫/前缀分类失效
- **组件里自建时间格式化 / 来源类型文案**：一律 `lib/format.ts` 的 `formatTime` 与 `lib/sourceTypes.ts` 的 `sourceTypeLabel`/`sourceTypeIcon`
- **破坏性操作无确认**：删除对象/笔记/标签必须 AlertDialog 确认（数量提示），删除对象提示级联笔记数
- **用户操作失败无反馈**：保存/创建等异步失败必须 toast 提示（`NoteForm.tsx:113` 保存失败），禁止静默吞错
- **装饰器修改文档内容**：CodeMirror 装饰只改显示，禁止在装饰器里改 doc / 拦截事务（`markdownDecorations.ts` 头部契约）
- **新增不必要依赖**：先查项目已有能力（shadcn/ui、lucide、zustand、CM6），不够再加

---

## Required Patterns

- 写操作先 db 后内存（store action 内 `await` 成功才 `set()`）
- 类型守卫是唯一收窄入口（`isNoteDoc` 等），新增文档类型必须配套守卫
- 更新必带 `_rev`（缺省由 db 层容错补齐，但显式传 rev 是默认写法）
- 破坏性/跨域操作走 store 编排（对象级联删除、标签删除引用清理），顺序：先清理引用再删本体
- 语义色 Token（禁止裸色值）、紧凑密度（h-7/h-8、text-xs）、无横向滚动（min-w-0 + truncate）
- 空态全覆盖：首页/标签/搜索无结果/对象详情/笔记全文均提供 Empty 引导
- 每个数据/服务/组件文件头部写 JSDoc 契约注释（design.md 章节引用 + 关键约束）

---

## Testing Requirements

冒烟测试体系（node 直测，`scripts/`，全部基于 MemoryDb 防御降级）：

| 脚本 | 覆盖 | 对应契约 |
|------|------|---------|
| `smoke-data-layer.ts` | schema 读写往返、_rev 冲突、`deleteObjectCascade` 级联、别名归并、`suggestTags` 联想、`findTagConflicts` 冲突、搜索语法（tokenize/type:前缀/#标签/裸词/相关度/空查询）、**AC9 归档笔记可搜**、`sortNotes` | 数据层 + 搜索 |
| `smoke-stores.ts` | bootstrap 幂等、对象 CRUD/钉住、**归档自动取消钉住（R12）**、标签删除跨域引用清理、`countNotesByTag`、对象级联删除内存同步、ui 选中互斥/编辑态、`resolveTagIds` 归并、排序/筛选持久、**搜索态排序迁移** | store 编排 |
| `smoke-decorations.ts` | 标题（光标行淡色/非光标行隐藏）、粗斜/行内代码/链接、任务复选框 Widget、引用/分隔线/代码块/列表标记 | 编辑器装饰 |

写法约定：`node:assert/strict` + 手写 `ok()` 计数，`main().catch(err => process.exit(1))` 失败即非零退出；每个脚本开头 `resetDbForTest()` 隔离数据。**新契约必须带冒烟断言**（如新增搜索语法、新增跨域编排），改动既有契约时先跑对应脚本确认未回归。

---

## Code Review Checklist

- [ ] 组件无直接 services/db import（受控例外外）；写操作均经 store action
- [ ] 类型守卫收窄、无 `as any` / 裸断言、无重复 schema 定义
- [ ] 更新带 `_rev`；删除/级联编排顺序正确；破坏性操作有 AlertDialog 确认
- [ ] 派生列表 useMemo 依赖齐全；selector 返回稳定引用（无 filter 直出）
- [ ] 新状态提升判定：跨组件消费才进 store；表单草稿留在本地
- [ ] 语义色 Token、紧凑密度、min-w-0/truncate 无横向滚动
- [ ] 空态/错误提示覆盖（保存失败 toast、AC10 强提示、无结果语法提示）
- [ ] 新契约有对应冒烟断言，`npm run smoke*` + `npm run typecheck` + `npm run build` 全绿
- [ ] dist/plugin.json 无 development 字段（stripDevelopmentField 生效）

---

## Render-Layer Pitfalls（白屏/崩溃实战教训，2026-08 排查记录）

纯逻辑冒烟**测不到渲染期错误**。以下三类问题曾导致整页白屏，新增/修改组件必须检查：

1. **Radix/shadcn Provider 缺失**：`Tooltip` 必须被 `TooltipProvider` 包裹（本项目在 App 根统一包 `<TooltipProvider>`，新组件不要再单独包）。其他 Provider 类组件（Dialog、Select 等）同理自查。
2. **Zustand selector 返回新引用**：`selectNotesByObject` 这类派生数组 selector 直接传给 `useStore` 会因 getSnapshot 不稳定触发无限重渲染。**必须用 `useShallow` 包裹**：`useNotesStore(useShallow((s) => selectNotesByTag(s, tagId)))`；对象引用（`.find()` 返回值）本身稳定，无需包。
3. **短路条件 Hook**：`const a = useX() && useY()` 在 `useX()` 返回 false 时跳过 `useY`，状态翻转后 Hook 顺序错位崩溃。**禁止用 `&&`/`||`/三元连接多个 Hook 调用**，一律拆开再合并。

**渲染层验证标准**：涉及组件/布局/编辑器改动的任务，必须跑 `npm run ui-smoke`（playwright-core + 系统 Edge 无头，走 MemoryDb 验证对象→笔记→钉住→首页核心闭环 + 无 console/pageerror）。Dev server 需先启动（5173）。
