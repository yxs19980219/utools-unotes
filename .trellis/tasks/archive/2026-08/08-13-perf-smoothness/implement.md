# ① 流畅度优化 —— 执行计划（child of 08-13-editor-performance）

## 执行清单

- [x] 1. 基准先行：`scripts/bench-decorations.ts`（500 行 0.170ms / 5000 行 2.453ms 基线）
- [x] 2. 语法树调研：dump 全部目标语法形态（标题/列表/任务/表格/引用/围栏/粗斜/链接/图片），确认 GFM 节点结构；CodeMirrorEditor 启用 `markdown({ extensions: [GFM] })`
- [x] 3. 重构 `markdownDecorations.ts`：语法树驱动（`addRangeDecorations` 节点映射），删除全部正则扫描（INLINE_RE/CODE_SPAN_RE/FENCE_RE/HEADING_RE/HR_RE/QUOTE_RE/TASK_RE/LIST_MARKER_RE/UL_MARKER_RE/scanTable/markTableRow/scanInline/scanInlinePlain）；保留 buildDecorations 导出签名与装饰类名
      - v2 增量重建尝试：因 RangeSetBuilder nextLayer 分层 + between 复制顺序冲突违规，实测无端到端收益，回退为 v3 全量重建（design.md §5 记录）
- [x] 4. 改造 `scripts/smoke-decorations.ts`：断言语义不变（仅标题标记范围 [0,2)→[0,1) 对齐 HeaderMark；state 补 LANG_EXT），8 组断言全绿
- [x] 5. React 链路优化：MarkdownToolbar memo、CodeMirrorEditor memo、NoteView handleChange/handleSave useCallback 稳定引用
- [x] 6. 基准对比：5000 行 2.453ms → 0.138ms（17.8 倍，阈值 <10ms ✓）；端到端 5000 行 9.2ms/键、DOM 变更 3 处、无 longtask
- [ ] 7. 用户 uTools 实测（长笔记输入/光标移动）——待验收

## 验证命令

```bash
npm run smoke:decorations      # 装饰断言全绿 ✓（8 项）
npm run typecheck              # tsc -b ✓
npm run build                  # 构建通过 ✓
npm run smoke                  # 数据层冒烟 ✓（19 项）
npm run smoke:stores           # stores 冒烟 ✓（18 项）
npm run ui-smoke               # UI 全流程 ✓（47 项）
node scripts/bench-decorations.ts  # 5000 行 0.138ms（基线 2.453ms，17.8 倍）
DOC_LINES=5000 node scripts/perf-input.mjs  # 端到端 9.2ms/键，DOM 变更 3 处，无 longtask
```

## Review 门

- [x] 步骤 3 完成后：codegraph 确认无残留正则引用、装饰模块只留语法树路径
- [ ] 用户 uTools 实测验收（步骤 7）

## 回滚点

- 步骤 3 实现前 git 打点；装饰模块异常 → `git checkout -- src/components/Editor/markdownDecorations.ts` 整体回退（导出签名不变，smoke 老版本测试仍可跑）
