# Directory Structure

> How frontend code is organized in this project.

---

## Overview

uTools 插件（React 19 + Vite + TypeScript + Tailwind 4 + shadcn/ui + Zustand 5），渲染进程全部代码在 `src/`。分层规则是**单向依赖**：

```
components/ → stores/ → services/ → types.ts
```

- `components/` 只读 store（hook 订阅）与写 store（action 调用），**绝不直接 import services/ 或触碰 utools.db**
- `stores/` 编排跨 store 一致性并调用 `services/db.ts`（唯一 db 写入口）
- `services/` 是数据层唯一契约 owner（类型守卫、_id 前缀、db 封装）
- `types.ts` 是全项目类型契约（schema v1），不 import 任何运行时层
- `lib/` 是展示层纯函数/轻量 hook（无副作用存储），可被 components 与 services 复用

例外（组件直接调 service 的**受控例外**）：`src/components/TagInput.tsx:96` 经 `useTagsStore.getState().create()` 调用 store action（不是直接碰 db）；`src/components/ContentHeader.tsx:175` 调用 `utools.subInputFocus()`（uTools 全局对象，不是 db）；`src/lib/sourceTypes.ts:44` 的 `useSourceTypes` hook 直接调 `getSourceTypes()` 读 db —— 这是模块级缓存的轻量读，设置域二期接入 store 后替换（见文件头注释）。

---

## Directory Layout

```
public/                # dev 模式资源（uTools 开发者工具加载）
  plugin.json          # dev 版含 development.main → http://localhost:5173
  preload/services.js  # 空壳 preload（最小权限桥，本期无自定义能力）
dist/                  # build 产物（vite build，base:'./'，file:// 协议加载）
  plugin.json          # stripDevelopmentField 插件删除 development 字段（铁律）
src/
  main.tsx             # 入口：applyTheme（prefers-color-scheme → html.dark）+ 挂载
  App.tsx              # 两栏布局骨架 + bootstrapStores + utools.onPluginEnter/setSubInput
  index.css            # 附录 A 设计 Token 契约（:root/.dark/@theme inline/@layer base）
  types.ts             # schema v1 全部领域类型 + 内置枚举常量
  services/
    db.ts              # utools.db 封装：DbAdapter 双实现 + 类型守卫 + 领域 CRUD
    tagNormalize.ts    # 标签规范化：matchTag / suggestTags / buildTagId / findTagConflicts
    search.ts          # 语法 tokenizer（type:x / #x / 裸词）+ 内存全文搜索 + 相关度排序
  stores/
    bootstrap.ts       # 启动全量加载（allDocs → 三域 hydrate，in-flight 幂等）
    ui.ts              # 视图/选中项/搜索态/编辑态/排序偏好
    objects.ts         # 对象域 + 派生 selector（selectPinnedObjects 等）
    notes.ts           # 笔记域 + 派生 selector（selectNotesByObject / selectNotesByTag）
    tags.ts            # 标签域 + 计数纯函数（countNotesByTag）
  components/          # 页面组件 + 通用组件
    ui/                # shadcn CLI 生成的组件（button/select/command/…），不手改
    Editor/            # CodeMirrorEditor.tsx + markdownDecorations.ts（即时渲染装饰）
    App 直接依赖：ViewSwitcher / SidebarList / ContentHeader / ContentArea
    内容形态：NoteCardList / NoteView / NoteForm / ObjectForm / ObjectDetail
    通用：SidebarRow / TagChip / TagInput / TagRowActions / MarkdownView
  lib/
    format.ts          # formatTime（展示时间格式化唯一入口）
    sourceTypes.ts     # 来源类型 UI 投影（图标/标签/useSourceTypes）
    utils.ts           # cn()（clsx + tailwind-merge）
scripts/               # node 直测冒烟测试（npm run smoke / smoke:stores / smoke:decorations）
```

路径别名：`@/` → `src/`（`vite.config.ts:33` resolve.alias + `tsconfig.json` paths）。

---

## Module Organization

- **按层建目录，不按功能建目录**：跨功能复用的是 NoteCardList / TagChip 等通用组件，属于全局职责，放 `components/` 根；UI 组件放 `components/ui/`（shadcn 产物）
- 新增领域逻辑（如二期归档视图）先问"它属于哪一层"：纯展示 → components/；状态编排 → stores/；db 读写 → services/；纯类型 → types.ts
- shadcn 新组件一律 `npx shadcn@latest add` 生成到 `components/ui/`，不手写不搬库
- Editor 装饰器（markdownDecorations.ts）是**纯显示层**：ViewPlugin + decorations，不改文档内容，不拦截事务

---

## Naming Conventions

- 组件文件 PascalCase（`NoteCardList.tsx`）；默认导出组件，具名导出辅助函数（如 `NoteCardList.tsx:42` 的 `excerptOf`）
- store 文件小写域名（`objects.ts` / `notes.ts` / `tags.ts` / `ui.ts`），hook 前缀 `use`（`useObjectsStore`）
- 类型守卫 `isXxxDoc`（`isNoteDoc` / `isObjectDoc` / `isTagDoc` / `isSettingDoc`，`src/services/db.ts:135-145`）
- db 前缀常量 `ID_PREFIX`（`src/services/db.ts:26`），消费方禁止硬编码 `'object/'` 字符串
- 派生 selector 前缀 `select`（`selectNotesByObject`、`selectPinnedObjects`），纯函数导出
- 每个文件头 JSDoc 注释：职责、契约（design.md 第几节）、关键约束（见 type-safety.md）

---

## Examples

- 分层接线范本：`src/components/ObjectDetail.tsx:36-43`（只订阅四个 store + 一个 lib hook，无 services import）
- store 编排范本：`src/stores/tags.ts` 的 `remove`（跨 notes/objects 域清理引用后再删标签文档）
- 数据层契约范本：`src/services/db.ts`（类型守卫 + DbAdapter 双实现 + assertOk）
- 唯一双模式文件：`vite.config.ts`（dev 用 public/，build 产物 dist/ 无 development 字段）
