# SourceNote 二期执行计划

## 前置：开工前需用户拍板（prd.md Open Questions）

- [ ] R13 链接色方案（推荐：foreground + underline）
- [ ] R14 归档笔记卡片删除入口（保留 or 纯只读）
- [ ] R3 取消归档是否本期做（推荐做）
- [ ] R9 偏好范围（仅默认排序 or 扩展）

## 检查清单（按序执行）

### 阶段 0：用户决策确认 + 基线
- [ ] 4 个 Open Questions 用户拍板 → 更新 prd.md
- [ ] `npm run ui-smoke` + 全部 smoke 跑一遍确认基线绿（防二期改动引入回归）

### 阶段 1：设置视图（来源枚举，独立可交付）
- [ ] `stores/settings.ts`：来源枚举 + prefs store（load/save action）
- [ ] `lib/sourceTypes.ts` 改造：useSourceTypes 改读 store，删除模块级 cached；消费方（ObjectForm 下拉、ContentHeader 筛选器）验证
- [ ] `SettingsView.tsx`：来源类型列表（内置锁定标记/自定义增删改 + 删除引用计数确认）+ 偏好（默认排序 Select）
- [ ] ViewSwitcher 放开「设置」tab + ContentArea 路由
- [ ] **验证**：AC4/AC5/AC6；`npm run ui-smoke` 全绿

### 阶段 2：归档视图
- [ ] SidebarList archived 分支（已归档对象列表 + 空态）
- [ ] ObjectDetail `readonly` prop + 「归档」按钮（首页详情）+「恢复」按钮（归档详情）+ AlertDialog 文案（含笔记计数）
- [ ] ViewSwitcher 放开「归档」tab + ContentArea 路由（archived 详情只读）
- [ ] NoteView 只读路径验收（已实现，回归确认）
- [ ] **验证**：AC1/AC2/AC3；ui-smoke 新增归档流程断言（归档→列表出现→恢复）

### 阶段 3：编辑器表格装饰（R10）
- [ ] markdownDecorations 表格行组检测 + 渲染（表头加粗/边框/分隔符淡色）
- [ ] smoke-decorations 新增表格断言
- [ ] **验证**：AC7；装饰器回归全绿

### 阶段 4：草稿保护（R11/R12）
- [ ] NoteView：draft 防抖落 localStorage + 恢复 + toast
- [ ] ui store `pendingDirty` 拦截：setView/selectObject/closeNote/startEditing 前检查 → AlertDialog（放弃/取消）
- [ ] NoteForm dirty 检测 + 同一拦截
- [ ] **验证**：AC8/AC9；ui-smoke 新增草稿断言

### 阶段 5：遗留项（R13/R14）
- [ ] 链接色修正（按拍板方案，编辑器 + MarkdownView 两处）
- [ ] 归档卡片删除入口（按拍板方案）
- [ ] **验证**：AC10/AC11

### 阶段 6：整体检查
- [ ] PRD 验收 AC1-AC12 逐条跑测
- [ ] `npm run typecheck` + 全部 smoke + `npm run ui-smoke` + `npm run build` 全绿
- [ ] dist 无 development 字段；800×600 无横向滚动
- [ ] trellis-check 派发（跨层数据流、规范合规、渲染层门禁）

## 验证命令

```bash
npm run typecheck
npm run smoke && npm run smoke:stores && npm run smoke:decorations
npm run ui-smoke        # 需 dev server (5173) + 系统 Edge
npm run build
```

## 风险与回滚点

| 风险 | 缓解 | 回滚点 |
|------|------|--------|
| 表格装饰与行内扫描冲突 | 表格行整体 mark、不 scanInline（单元格内语法 MVP 不渲染） | 阶段 3 起点 |
| 草稿拦截误弹窗 | dirty 仅实际改动时置位；保存即清 | 阶段 4 起点 |
| 枚举 store 改造影响既有表单 | 阶段 1 完成后先跑 ui-smoke 再继续 | 阶段 1 起点 |
| 设置/归档 tab 放开后空态缺失 | 两视图都有 Empty 空态 | 阶段 1/2 起点 |

## 收尾

- [ ] 更新 spec（如本期发现新模式/坑，按 Workflow Conventions 沉淀）
- [ ] 版本号 1.0.0 → 1.1.0（MINOR：新功能），按 Release Process 发布
- [ ] 任务 finish + archive
