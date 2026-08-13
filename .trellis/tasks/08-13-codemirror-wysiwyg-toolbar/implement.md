# CodeMirror 所见即所得工具栏与编辑器渲染优化——执行计划

## Iteration 1 progress

- [x] Stage 0：审查 `@markwhen/codemirror-tables`，确认不作为正式依赖。
- [x] Stage 1：Markdown 表格模型、转义管道符、源码范围和 Node smoke。
- [x] Stage 2：StateField 驱动的表格 block decoration，与轻量表格装饰隔离。
- [x] Stage 3：真实 table、nested cell editor、表格工具条、Tab/Enter/行列操作。
- [x] Stage 4：代码块空行插入、围栏按编辑上下文隐藏/显示、空语言 picker。
- [x] Stage 5：UI smoke 覆盖代码块、真实表格、单元格编辑、键盘导航和持久化。
- [ ] uTools 目标环境实测、最终 trellis-check、spec 回顾和提交。

## 执行前门禁

- [x] 用户已批准本任务最新规划摘要；只批准创建任务不等于批准实现。
- [x] `prd.md`、`design.md`、`implement.md` 已完成且无阻塞性开放决策。
- [x] 先读取 `trellis-before-dev` 注入的 frontend spec；实现/检查上下文包含本任务 research 文件。
- [x] 在当前基线重新运行 `npm run typecheck`、`npm run smoke:decorations`、`npm run smoke:tableOps`，确保后续失败可归因。
- [x] 不在生产代码中引入第三方表格包，直到兼容性 spike 通过并完成依赖审查。

## 阶段 0：依赖兼容性 spike（已完成）

1. 已核验 `@markwhen/codemirror-tables@0.1.1` tarball 的实际导出：正式入口是 `createTableExtension`，README 示例存在 `tableExtension` 命名漂移。
2. 已核验其类型结构包含表格模型、cell ranges、nested editor、`syncAnnotation`、`estimatedHeight` 等可参考机制。
3. 已做 Node/headless import 探针：包在模块初始化阶段依赖浏览器 DOM 与 `DOMPurify.addHook`，不能直接进入本项目的 Node smoke；包内还带有 Joplin 风格渲染处理。
4. 结论：不把该包写入正式依赖；正式实现参考其结构并采用项目内最小 GFM 表格扩展，避免无必要依赖和产品假设。

**门：** 依赖审查已通过“不引入不兼容包”结论，进入纯模型阶段；父子 transaction、焦点、撤销和 widget 生命周期在自研实现阶段逐项验证。

## 阶段 1：表格纯模型与范围契约

1. 新建/整理 `src/lib/markdownTableModel.ts`，实现 GFM 表格解析、转义 pipe、对齐、ragged row 归一化、cell source/editable ranges、序列化。
2. 将 `src/lib/tableOps.ts` 的增删行列逻辑迁移到模型 API；保留现有行为边界（最小数据行、最小列数、列数上限）并明确返回值。
3. 新增 `scripts/smoke-tableModel.ts` 或扩展 `smoke-tableOps`，覆盖：标准表格、首尾 pipe、escaped pipe、空单元格、不规则行、表格后正文、增删行列和 round-trip。
4. 不触碰 React/DOM；先保证模型纯函数可被 Node 直接加载。

**回滚点 R1：** 纯模型提交可独立回退，不改变编辑器运行时。

## 阶段 2：Block decoration 基础

1. 新建 `src/components/Editor/markdownBlockWidgets.ts`，使用 `StateField<DecorationSet>` 提供 block decorations。
2. 从 Lezer `Table` 节点定位候选范围，再交给 table model 校验；半成品表格保持源码显示。
3. 将当前 `markdownDecorations.ts` 中表格整行样式和行首 `TableToolbarWidget` 移出，避免与 block replacement 重叠；保留其他轻量装饰。
4. 明确 `atomicRanges`、selection mapping 和 table range 映射；表格删除/外层选择必须仍能通过 transaction 作用于原 Markdown。
5. 增加 headless state/build 测试，至少确认：非表格不生成 widget、完整表格生成一个跨行 range、表格文本变化后 range 正确重算。

**门：** 不能在 ViewPlugin 间接 decorations 中放影响垂直布局的 block widget；若测试发现布局/光标异常，先修正 StateField 设计再继续。

**回滚点 R2：** 仅回退 block decoration wiring，轻量 Markdown 装饰保持可运行。

## 阶段 3：TableWidget 与 nested cell editor

1. 实现 `TableWidget` DOM 结构、主题 class、header/body cell data attributes、空态和安全 text rendering。
2. 实现 cell range 到逻辑 cell 的解析，点击 cell 时创建单行 nested `EditorView`；外层 widget 不用 React 渲染。
3. 实现 nested transaction → outer transaction 的 offset changes 转换，使用 `syncAnnotation` 防循环；外层 update 时保留 active cell 的 nested view 和 selection。
4. 实现 TableWidget `eq/updateDOM/destroy`；结构变更重建，连续文本变更尽量复用 DOM；清理 ResizeObserver、nested views 和事件监听。
5. 实现 `estimatedHeight`、ResizeObserver/requestMeasure；大表/多表/表后正文滚动不跳。
6. 实现表格工具条：当前 cell 行增删、当前列增删、边界禁用、aria-label；所有操作通过 table model 序列化后单次 outer dispatch。
7. 实现键盘行为：Tab、Shift+Tab、Enter、Escape；MVP 明确不支持单元格多行输入。
8. 更新 `MarkdownInsertApi` 的表格插入命令，使插入后第一数据 cell 成为 active cell，并保持外层自动保存。

**门：** 浏览器实测通过中文输入、连续输入、撤销/重做、点击外层正文、删除表格、切换笔记；任一失败不得进入最终 UI 打磨。

**回滚点 R3：** 表格 widget 与 nested controller 单独提交；可以回到当前表格源码编辑工具条而不影响代码块/标题。

## 阶段 4：代码块视觉编辑

1. 在 `CodeMirrorEditor.tsx` 配置稳定的 Markdown GFM 扩展；保留当前常见语言选择器，后续按需接入 `codeLanguages`。
2. 在 `markdownDecorations.ts` 调整 `FencedCode`：代码内容行是稳定视觉代码区，围栏/语言标记按光标上下文显示或隐藏；不使用 nested code editor。
3. 处理无 `CodeInfo` 的围栏 point widget；语言选择时插入 info，不依赖空区间 replace。
4. 调整代码块工具栏插入与光标位置，确保插入后立即出现代码区域并可连续输入。
5. 若接入语言高亮，使用按需 LanguageDescription，验证 bundle、加载失败和 uTools 旧内核，不一次性导入所有语言包。

**回滚点 R4：** 代码块视觉变更可独立回退到当前围栏/CodeText 装饰，不影响表格。

## 阶段 5：工具栏、图片和内容渲染回归

1. `MarkdownToolbar.tsx` 的按钮通过 API dispatch，使用 pointer/mousedown 保持 selection；表格/代码块按钮不得仅插入后让用户看到裸语法。
2. 保留图片选择器和 ImageWidget 契约；补充 uTools file path、浏览器 File/Blob URL、括号转义和失败渲染测试。
3. 回归标题 1~6 级字号、列表空格触发、列表左右间距、Tab 嵌套符号、软换行、粗斜链接/任务/引用/分隔线。
4. 清理旧表格工具条和旧表格装饰样式，避免同一表格同时出现源码行背景和真实 table。

## 阶段 6：测试与验收

### Node / headless

```bash
npm run typecheck
npm run smoke:decorations
npm run smoke:tableOps
node scripts/smoke-tableModel.ts
npm run smoke
npm run smoke:stores
npm run smoke:outline
```

至少新增/更新断言：

- 完整表格只生成一个 block widget；半成品保留源码；
- 单元格输入回写正确 Markdown，`\\|` round-trip 不丢失；
- 增删行列、Tab/Enter/Escape、撤销/重做；
- 代码块语言选择修改 info，代码内容和围栏可往返；
- 列表无空格时不装饰为列表。

### 浏览器 / UI smoke

扩展 `scripts/ui-smoke.mjs`，在现有创建笔记流程中增加：

1. 点击代码块按钮，确认代码视觉区域出现；输入代码、切换语言、重开笔记后源码与视觉状态一致。
2. 点击表格按钮，确认真实 `table`/`thead`/`tbody` 出现；点击 cell 输入；Tab/Enter 导航；增删行列；撤销；重开笔记后 Markdown 结构保留。
3. 验证多个表格、表格后普通段落、800×600 无页面横向滚动、无 pageerror/console error。
4. 保留现有实时保存、标题、列表、图片和归档只读回归。

运行前启动 dev server（5173），再执行：

```bash
npm run ui-smoke
```

### 性能与构建

```bash
node scripts/bench-decorations.ts
DOC_LINES=5000 node scripts/perf-input.mjs
npm run build
```

现有装饰基线 5000 行阈值不回退；额外验证 10×10、50×20 表格渲染/输入不会产生明显长任务或滚动跳动。构建出现新增大包时必须说明来源并优先动态加载语言包。

### uTools 实测

- 真机/目标 uTools 内核验证本地图片 `file://`、文件选择器、中文 IME、复制/粘贴、撤销、焦点切换。
- 验证表格 widget 的 ResizeObserver、nested editor 和旧内核 CSS/selection 行为。
- 发现浏览器 smoke 与 uTools 差异时，先在任务中记录差异，不用运行时 fallback 掩盖问题。

## 最终 review gate

- [x] `prd.md`、`design.md`、`implement.md` 与代码实现一致，无临时假设残留。
- [x] 未改变数据库 schema、Note content 数据契约和自动保存语义。
- [x] 表格真实 DOM、单元格编辑、结构操作、Markdown round-trip、焦点/撤销/滚动全部有浏览器/Node 证据；uTools 中文 IME 仍待目标环境实测。
- [x] 所有现有 smoke、UI smoke、性能和 build 通过。
- [x] 运行 `trellis-check`，确认 spec、类型、跨层数据流、无重复实现和安全性。
- [x] 运行 `trellis-update-spec`，仅在本轮确实形成新的项目级编辑器契约时更新 frontend spec。
- [x] 提交前确认 git diff 只包含本任务范围；按独立回滚点提交。
