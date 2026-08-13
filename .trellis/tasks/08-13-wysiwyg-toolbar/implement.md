# ② 所见即所得工具栏 —— 执行计划（child of 08-13-editor-performance）

## 执行清单

- [ ] 1. 图片：`ImageWidget`（replace Image 节点 → `<img>` + onerror 占位）+ 工具栏图片按钮
      （showOpenDialog → 插入 `![文件名](路径)`，路径 `()` 转义）+ CSS（max-width 100%）
- [ ] 2. 代码块语言选择器：`LangPickerWidget`（替换 CodeInfo → 语言名 + ▾）+ 语言菜单
      （Popover + Command 复用，锚定 widget 元素）+ 选择 dispatch 修改 CodeInfo + 工具栏
      代码块按钮默认插入 ```ts
- [ ] 3. 表格工具条：`TableToolbarWidget`（光标所在表格的 TableHeader 行首）+ 增删行列
      源码操作函数（lib/tableOps.ts 纯函数：addRow/delRow/addCol/delCol，行级 splice）
      + 工具栏表格按钮插入 3 列 2 行
- [ ] 4. MarkdownInsertApi 扩展：insertImage / 语言选择 dispatch（view 访问已有）
- [ ] 5. 测试：smoke-decorations 新增 Image widget 断言；lib/tableOps 纯函数单测
      （smoke-outline 同方式新增 smoke-tableOps 或并入）；headless 交互验证
      （图片插入渲染 / 语言选择改源码 / 表格增删行列）
- [ ] 6. 回归：typecheck / build / smoke×N / ui-smoke 47 项 / bench 性能不回退
- [ ] 7. uTools 实测：file:// 图片显示验证、整体交互手感

## 验证命令

```bash
npm run typecheck
npm run build
npm run smoke / smoke:stores / smoke:decorations / smoke:outline
npm run ui-smoke
node scripts/bench-decorations.ts   # 5000 行 < 10ms 不回退
```

## Review 门

- 步骤 3 完成后：tableOps 纯函数单测覆盖（表头/单行/多列/删到边界）
- 步骤 5 后：请用户 uTools 实测验收（图片 file:// 是关键验证点）

## 回滚点

- 各增强独立提交打点；图片 widget / 语言选择器 / 表格工具条可分别回退
