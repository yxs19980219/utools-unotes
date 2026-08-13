# ① 流畅度优化：输入卡顿诊断与修复（需求 16）

## Goal

用户反馈输入不流畅，与 Typora 差距明显。调研结论：Typora 流畅的核心是「无框架层直接操作 DOM + 增量渲染只算光标行附近」。本项目同为 CodeMirror 6，但自研装饰（markdownDecorations.ts）每次输入/光标跨行都对全文跑 8+ 个正则 + RangeSetBuilder 全量重建，是卡顿主因。本轮：性能实测定位 → 重构为语法树驱动装饰 → React 链路顺带优化，为后续 child ②（所见即所得 Widget）和 ④（列表嵌套层级）打地基。

## Requirements

1. 定位卡顿根因并以数据证实（装饰重建耗时 / React 重渲染 / 其他）
2. 装饰生成从「正则全量重扫」改为「lezer 语法树驱动」（@codemirror/lang-markdown 自带，增量解析）
3. 语法树方案必须启用 GFM 扩展（表格/任务列表节点），确保现有全部装饰功能无回归
4. 光标行机制保留：光标行标题标记淡色、非光标行隐藏
5. React 链路顺带优化：输入时减少无谓重渲染（仅在不伤架构前提下）
6. 为 child ④（列表嵌套符号）和 ②（图片/代码块/表格 Widget）提供语法树结构基础
7. 产出可重复的性能基准脚本（headless benchmark），供后续 child 回归对比

## Acceptance Criteria

- [x] 基准脚本 scripts/bench-decorations.ts：500 行 0.116ms / 5000 行 0.138ms（基线 0.170/2.453ms，提升 17.8 倍，阈值 500 行 < 2ms、5000 行 < 10ms ✓）
- [x] smoke-decorations 全部断言等价通过（8 组，语法树版本）
- [x] 装饰行为无回归：标题/粗斜/行内码/链接/任务框/引用/分隔线/围栏/列表/表格——ui-smoke 47 项全绿；唯一差异：标题标记范围不含后续空格（HeaderMark 仅 `#`，视觉无差）
- [x] 光标跨行不再触发正则重扫（全量语法树遍历 0.14ms/5000 行；增量重建 v2 因 RangeSetBuilder 分层顺序问题回退，见 design.md §5）
- [ ] 用户手动验证：uTools 内 ≥500 行长笔记输入、光标上下移动流畅——**待用户实测**
- [x] 不引入新依赖（@lezer/markdown、@codemirror/language 均为已有传递依赖，package.json 未变）

## Notes

- 依赖 parent 任务地图：本任务最先执行；④ 的列表嵌套符号实现依赖本任务的语法树基础，② 依赖本任务性能基线。
- 回滚点：git commit 打点，装饰模块可整体回退。
