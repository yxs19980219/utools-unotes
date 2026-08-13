# ① 流畅度优化 —— 技术设计（child of 08-13-editor-performance）

## 1. 背景与根因（已代码级确认）

当前输入链路（每次按键）：

```
按键 → docChanged → markdownDecorationPlugin.update()
     → buildDecorations()：遍历全部行（for n=1..doc.lines）
       → 每行跑 FENCE/HEADING/TABLE_SEP/TABLE_ROW/HR/QUOTE/TASK/LIST_MARKER 等 8+ 正则
       → 行内再跑 CODE_SPAN + INLINE 两个正则
       → RangeSetBuilder.add 全部结果
光标跨行 → 同样全量重建（仅因标题标记显隐依赖光标行）
```

复杂度：每次按键 O(总行数 × 正则数 × 行长)。1000 行文档 ≈ 1 万+ 次正则调用。
uTools WebView 性能弱于独立 Chromium，放大了开销。

React 链路（次要，已确认无大问题）：
- NoteView 本地 `draft` state 每次输入 setState → NoteView 重渲染（无法避免，value 受控）
- 但 CodeMirrorEditor 的 extensions/theme/basicSetup 已 useMemo 固定引用 → @uiw 不会 reconfigure EditorView（已达标）
- 可顺带优化：MarkdownToolbar 未 memo（api 引用稳定但每次输入仍整栏重渲染）；handleChange/onSave 每次渲染重建引用（无实际危害，可顺手稳定）

## 2. 方案选型

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A | 保留正则，只增量重建变化行 | 改动小 | 正则每行成本仍高；跨行块（围栏/表格）边界易错；④ 嵌套层级做不了 | ✗ |
| B | **语法树驱动装饰**：lezer 增量解析 + 单遍遍历语法树生成装饰 | 解析增量（只重解析变化区）；单遍 O(n) 无正则重扫；节点结构天然带嵌套层级（④ 直接用）；官方推荐模式（CM6 decorations 指南即此） | 重构量中等；GFM 解析细节需对齐现有行为 | ✓（选 B+C 组合） |
| C | 语法树 + DecorationSet.map 局部增量重建 | 每键只重建变化行，DOM 变更最小化 | 复杂度较高 | ✓（与 B 组合） |

**实测修正（基准先行结论）**：
- 装饰构建 CPU：5000 行 2.45ms（node V8）——纯正则并非主瓶颈
- 真实浏览器（headless Chromium）端到端：5000 行 9.3ms/键、长行 7.6ms、滚动 166fps、IME 合成 7.7~12.3ms/步——**标准 Chromium 全部流畅**
- 结论：卡顿来自 uTools WebView 环境（禁 GPU/软件渲染）对每键工作量的放大
- 因此最终方案 = B（语法树驱动）+ C（变化行局部重建 + map 复用）：把每键工作量降一个数量级，5000 行文档每次按键只重建 1~3 行装饰（含跨行容器扩展），未变区域从旧 DecorationSet map 复用，DOM 变更量最小化

选 B+C 理由：主因是「正则全量重扫 + 每次按键全量 diff 整文档装饰集」。lezer 解析器本身增量；增量重建让每次按键的 RangeSet 构建/diff 只覆盖变化行。且 ②（图片/表格 Widget）与 ④（嵌套符号）都需要结构化语法树，B 是它们的共同地基。

## 3. 目标架构

```
markdown({ extensions: [GFM] })   ← 启用表格/任务列表解析（当前无参调用，语法树无 Table/TaskList 节点）
        ↓
lezer 增量解析（框架内建，输入时只重解析变化区域）
        ↓
markdownDecorationPlugin.update()
  ├─ docChanged        → 遍历 syntaxTree(view.state) 生成全部装饰（单遍）
  └─ 仅光标行变化      → 只重建「旧光标行 + 新光标行」两行的标题标记显隐装饰（其余装饰复用，map 不变）
        ↓
RangeSetBuilder → DecorationSet
```

关键点：
1. **语法树遍历**：`syntaxTree(state).topNode` 先序遍历，按节点类型映射装饰（见 §4 映射表）。忽略 `Document`/`Paragraph` 等容器节点，只处理叶子/样式节点。
2. **光标行机制**：遍历时对 ATXHeading 节点判断其起始行是否等于光标行 → dimMark / hiddenMark。纯光标行变化时：旧装饰保留，仅替换两行的 heading 标记装饰（用 `Decoration.set(this.decorations, true)` + 局部 builder 重建该行，或更简单：重建时跳过——详见 §5 性能策略）。
3. **源码零改动**：装饰只改显示，输入/撤销/拼写零副作用（延续现有契约）。

## 4. 节点 → 装饰映射表（语法树 dump 已确认）

| lezer 节点 | 结构（实测 dump） | 装饰 |
|---|---|---|
| ATXHeading1..6 | `HeaderMark` + 内容 | HeaderMark → dim（光标行）/hidden（非光标行）；内容 → headingMarks[n]；5/6 级复用 h4 样式 |
| FencedCode | `CodeMark` + `CodeInfo`? + `CodeText` + `CodeMark` | 开 CodeMark+CodeInfo → fenceMark；CodeText → codeBlockMark；闭 CodeMark → fenceMark |
| Emphasis / StrongEmphasis | `EmphasisMark` + 隐式文本 + `EmphasisMark` | 首尾 EmphasisMark → dim；中间区间 → italic/boldMark（嵌套时区间重叠，多层 mark 合法） |
| InlineCode | `CodeMark` + 隐式文本 + `CodeMark` | 首尾 CodeMark → dim；中间 → codeMark |
| Link / Image | `LinkMark` `LinkMark` `LinkMark` `URL` `LinkMark`（含隐式文本） | 首 LinkMark → dim；[首.to, 次.from) → linkMark；剩余 → dim。Image 本轮同链接处理（② 换图片 Widget） |
| Blockquote | `QuoteMark` + 子内容 | QuoteMark → dim；覆盖行 → quoteMark（多行引用每行） |
| BulletList / OrderedList → ListItem | `ListMark` + 内容 | 无序 ListMark → BulletWidget 替换（含后续空白）；有序 ListMark → dim；嵌套层级 = ListItem 祖先链深度（④ 消费） |
| TaskList → ListItem → Task | `ListMark` + `Task(TaskMarker)` | ListMark → dim；TaskMarker → TaskBoxWidget 替换 |
| Table | `TableHeader` + `TableDelimiter`(分隔行) + `TableRow`* | 表头行整行 head+first；分隔行整行 sep；数据行整行 row，末行 last；行内 TableDelimiter → dim；**不递归 Table 内部**（维持「单元格内不 scanInline」） |
| HorizontalRule | 单节点 | 整节点 → hrMark |

**关键**：lezer 隐式文本无节点（如 `**粗**` 的中间），按位置区间处理；深度优先先序遍历 = 位置递增，满足 RangeSetBuilder 顺序要求；相同 from 连续 add 合法（Blockquote 行装饰与 QuoteMark dim 重叠）。

## 5. 性能策略（最终 v3：全量语法树重建）

**演进记录**：
- v1 正则全量重扫（基线）：5000 行 2.45ms/次
- v2 增量局部重建（变化行 + map 复用）：因 RangeSetBuilder 分层存储（nextLayer）与
  `between` 复制回调顺序冲突（层级回调 from 逆序）导致 `Ranges must be added sorted` 违规；
  且实测 CM6 RangeSet.compare 本就只 diff 变化部分（每键 DOM 变更 3 处，增量版无额外收益）→ 回退
- **v3 全量语法树重建（最终）**：每次 docChanged / 光标跨行 → `buildDecorations` 单遍遍历语法树
  （lezer 解析器增量更新，只重解析变化区域）；5000 行 0.138ms（17 倍提升）

复杂度：每键 O(节点数) 遍历（5000 行 ≈ 0.14ms）+ CM6 compare 增量 DOM 更新（实测 3 处变更）。
实测端到端（headless Chromium，5000 行）：avg 9.2ms/键，无 longtask，166fps 滚动。

## 6. 兼容与回滚

- `buildDecorations(state)` 导出签名保留（smoke 测试与新 bench 共用），内部实现换成语法树版
- 若 GFM 解析导致表格/任务列表显示异常，回退点：FENCE 等正则版已 git 打点，整体 revert 装饰模块
- smoke-decorations.ts 断言**语义不变**（相同文档相同光标 → 相同装饰类/范围），仅实现路径变化；断言覆盖的用例须在新实现全绿

## 7. 边界与风险

- lezer 对非法/半成品语法（输入中的中间态如 `**` 未闭合）的树形与正则行为不同 → 装饰可能闪烁；Typora 同样有中间态，可接受，但需手动验证常见输入序列
- Emphasis 嵌套（`**bold *italic* **`）lezer 解析与正则"最长形态"规则不同 → 以 smoke 断言固化期望行为
- GFM 表格要求表头分隔行语法严格，用户输入不规范时 lezer 可能不识别为 Table → 退化为普通行，视觉可接受（现正则版要求同样严格）
- `markdown({ extensions: [GFM] })` 会同时启用 GFM 的 autolink/strikethrough 解析 → strikethrough 可顺带支持（④ 考虑），autolink 仅影响树结构不影响装饰
