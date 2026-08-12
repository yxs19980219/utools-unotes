# SourceNote 三期执行计划：对象一维状态 + 视图顶栏统一

## 阶段 0：基线
- [ ] `npm run typecheck` + 全部 smoke + ui-smoke 确认基线绿（二期交付状态）
- [ ] 抽查一期 pinned 依赖点（grep `pinned` 全仓，列全消费方清单）

## 阶段 1：状态模型一维化（独立可交付）
- [ ] `objects.ts`：删 togglePinned/selectPinnedObjects；create 去默认钉住；setArchived 去联动
- [ ] `SidebarList` 首页分组改为活跃对象（updatedAt 倒序）+ 分组标题「活跃对象」
- [ ] `ObjectDetail` 删除钉住按钮；`NoteForm` activeObjects 不变
- [ ] smoke-stores `[3]` 改写：一维状态断言（创建即活跃可见、归档→消失、恢复→立即出现）
- [ ] **验证**：smoke:stores + smoke + typecheck 全绿

## 阶段 2：ContentHeader 语境化顶栏
- [ ] ContentHeader 重构：语境矩阵（editing/搜索/对象活跃/对象归档/标签/空态）；对象详情操作区（排序/＋新笔记/归档/编辑/删除；只读态 恢复）+ 元数据第二行；删「新建▾」与搜索按钮
- [ ] ObjectDetail 瘦身：删元数据条/列表标题行/操作按钮（归档/删除 AlertDialog 逻辑上移 ContentHeader）
- [ ] 笔记数订阅、已归档 Badge 展示
- [ ] **验证**：typecheck + ui-smoke 手动走查对象详情（AC4/AC5/AC6）

## 阶段 3：侧边栏对象行右键菜单
- [ ] 新增 `ui/context-menu.tsx`（shadcn 标准）
- [ ] SidebarList：活跃对象行 ContextMenu（编辑/归档/删除，受控 AlertDialog 确认含笔记数）；归档对象行（恢复/删除）
- [ ] 首页「活跃对象」分组标题 + 按钮（新建对象入口）
- [ ] **验证**：AC2/AC3/AC7；ui-smoke 新增右键流程断言（playwright `click({ button: 'right' })`）

## 阶段 4：标签视图 + NoteView + 对象表单
- [ ] 标签视图顶栏确认（标签名 + 排序 + 来源筛选；无新建入口）——ContentHeader 语境矩阵中 selectedTag 分支即此，验证 AC8
- [ ] NoteView 顶栏删对象名链接（AC9）
- [ ] ObjectForm 删标签输入 + resolveTagIds；ObjectDetail 删对象标签展示（AC10，含旧数据打开验证）
- [ ] **验证**：AC8/AC9/AC10；smoke:stores 核查 resolveTagIds 相关断言不受影响

## 阶段 5：整体检查
- [ ] PRD AC1-AC12 逐条跑测（ui-smoke 断言全覆盖）
- [ ] `npm run typecheck` + smoke + smoke:stores + smoke:decorations + ui-smoke + build 全绿；dist 无 development
- [ ] 800×600 无横向滚动（ui-smoke viewport 断言）
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
| ContentHeader 重构破坏既有语境（搜索/编辑态） | 阶段 2 完成即跑 ui-smoke；语境矩阵逐分支走查 | 阶段 2 起点 |
| 右键菜单焦点/嵌套问题 | 受控 AlertDialog；ui-smoke 右键断言 | 阶段 3 起点 |
| 去 pinned 影响一期断言 | 阶段 1 先改 smoke-stores 再改代码（测试先行） | 阶段 1 起点 |
| 对象标签去除影响 tags 域编排 | removeTagFromObjects 保留；smoke-stores [4] 回归 | 阶段 4 起点 |

## 收尾

- [ ] 更新 spec（如本期发现新模式/坑，按 Workflow Conventions 沉淀）
- [ ] 版本号 1.1.0 → 1.2.0（MINOR：UI 重构 + 交互简化），按 Release Process 发布（用户确认后）
- [ ] 任务 finish + archive
