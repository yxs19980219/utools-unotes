# SourceNote 二期技术设计

基于一期代码现状（v1.0.0，`main` 分支）。一期相关实现：`src/stores/objects.ts`（setArchived 已含自动取消钉住）、`src/services/db.ts`（getSourceTypes/saveSourceTypes 已就绪）、`src/components/NoteView.tsx`（readonly 渲染已就绪）、`src/components/ViewSwitcher.tsx`（归档/设置 disabled 占位）、`src/lib/sourceTypes.ts`（useSourceTypes 模块级缓存无失效）。

## 1. 归档视图

### 数据流

```
对象详情 [归档] → AlertDialog（确认文案含笔记计数）→ objects.setArchived(id, true)
  → store 更新 + db 写（已实现）→ ui 侧边栏切到归档视图显示 selectArchivedObjects
归档视图对象详情 [恢复] → AlertDialog → setArchived(id, false)（pinned 保持 false）
```

- 侧边栏：`SidebarList` 增加 `view === 'archived'` 分支（复用 `SidebarRow`，来源图标 + 标题 + 归档时间 Badge），点击 → `selectObject(id)`
- 内容区：归档对象详情复用 `ObjectDetail` 加 `readonly` prop（隐藏「＋新笔记」「钉住」「编辑」「归档」按钮，显示「恢复」）；元数据条为只读态
- NoteView readonly 已实现（R4 验收项）

### 边界

- 归档对象在首页钉住列表自动消失（selectPinnedObjects 过滤 `!archived`，已实现）
- 归档对象不可被新建笔记选为归属（NoteForm 兜底 Select 只列未归档对象，已实现）
- 恢复后不自动钉住（R3 决策：需用户重新钉住）

## 2. 设置视图（来源类型枚举管理）

### 数据模型

```
setting/source-types: { types: [{ name: string, builtin: boolean }] }
setting/prefs:        { defaultSort: 'updatedAt' | 'createdAt' | 'title' }
```

- 内置 6 种（`BUILTIN_SOURCE_TYPES`）**锁定**：不可删、不可改名；自定义类型可增删改（R7 决策）
- 删除被引用类型：**允许强制删除**——`db.ts` 统计引用计数（扫 objects），AlertDialog 提示「有 N 个对象使用该类型」；删除后对象字段保持原字符串，仅下拉/筛选器不再出现

### 缓存失效（关键修复点）

`useSourceTypes`（`src/lib/sourceTypes.ts`）模块级 `cached` 变量导致设置页改动不生效。修复方案：改为 **Zustand store**（`stores/settings.ts`）持有枚举 + `loadSourceTypes/saveSourceTypes` action；`useSourceTypes` 改为读 store（或改为受 `version` 状态驱动）。新建对象下拉与筛选器全部消费 store，一处改动全局生效。

### 偏好

- `setting/prefs` 读写走 `db.ts` 已有 Setting 封装；默认排序在 `useUiStore` 初始化时合并读取（无则默认 `updatedAt`）
- 排序选项与一期 ContentHeader 排序菜单一致（relevance 仅搜索态，不进偏好）

## 3. 编辑器增强

### 表格装饰（R10）

- 检测：`|` 开头且含 `|` 的行 + 下一行是分隔行（`|---|`）→ 标记为表格行组
- 渲染：表格行 mark decoration——表头行 `fontWeight 600` + 底部 `borderBottom`；单元格分割 `|` 淡色；整表 `border` 细线 + `muted` 背景（保持文本流可编辑，不用 replace widget）
- 注意与列表/引用装饰的顺序：表格检测放在标题之后、列表之前
- 性能：与现有装饰器一致（行级正则 + RangeSetBuilder）

### 草稿保护（R11/R12）

- **正文草稿**：NoteView 编辑态 `draft` 变化时防抖（500ms）写入 `localStorage 'sn:draft:<noteId>'`；保存成功/明确放弃时清除。重新进入 NoteView 时检测 draft → 恢复 + toast「已恢复未保存的草稿」
- **切走确认**：NoteView 编辑态有未保存改动时，返回按钮/`closeNote`/`selectObject` 触发前拦截——实现：ui store 增加 `pendingDirty` 标志，路由切换动作（setView/selectObject/closeNote/startEditing）检查标志 → 弹 AlertDialog（放弃/取消）；「放弃」清 draft 继续，「取消」留在原处
- NoteForm 同样：`dirty` 检测（title/tags 与初始值比对）+ 同一路由拦截
- 插件关闭（onPluginOut）：draft 已防抖落盘，天然安全

## 4. 遗留项（R13/R14，待用户拍板后实现）

- 链接色：编辑器 `markdownDecorations.ts` 与 `MarkdownView.tsx` 的链接 class 改用 `color: var(--foreground) + underline`（方案 a）或用户指定
- 归档卡片删除：`NoteCardList` 的 `object?.archived` 分支放开删除按钮（方案 a）或保持隐藏

## 5. 改动文件清单（预估）

| 文件 | 改动 |
|------|------|
| `src/stores/settings.ts` | 新增：来源枚举 store + prefs |
| `src/lib/sourceTypes.ts` | useSourceTypes 改读 store（删模块级缓存） |
| `src/components/SidebarList.tsx` | archived 分支（已归档对象列表） |
| `src/components/ObjectDetail.tsx` | readonly prop + 归档/恢复按钮 |
| `src/components/ViewSwitcher.tsx` | 放开 archived/settings tab |
| `src/components/SettingsView.tsx` | 新增：来源类型管理 + 偏好 |
| `src/components/ContentArea.tsx` | settings 视图路由 + archived 详情路由 |
| `src/components/Editor/markdownDecorations.ts` | 表格装饰 + 链接色 |
| `src/components/MarkdownView.tsx` | 表格渲染 + 链接色 |
| `src/components/NoteView.tsx` | 草稿保护 + 切走确认 |
| `src/stores/ui.ts` | pendingDirty 拦截 + prefs 合并 |
| `scripts/ui-smoke.mjs` | 归档/设置流程断言 |

## 6. 风险与权衡

| 风险 | 缓解 |
|------|------|
| 表格装饰与行内扫描冲突（单元格内粗体等） | 表格行先整体 mark，内部不 scanInline（MVP 折中，单元格内语法不渲染） |
| 草稿拦截影响正常切走（误弹窗） | dirty 判定仅「有实际改动」；保存后立即清标志 |
| 强制删除类型导致对象类型悬空 | 对象保留字符串，筛选器容错（未知类型归入「其他」显示） |
| localStorage 草稿与 MemoryDb 测试隔离 | 草稿 key 带 noteId，ui-smoke 用后清理 |
