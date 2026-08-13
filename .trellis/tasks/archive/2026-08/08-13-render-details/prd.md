# ④ 渲染细节与工具栏样式（需求 1、12-15）

## Goal

内容区渲染细节打磨 + 工具栏样式：标题 # 大小分级、列表间距与嵌套符号、软换行、按钮栏上下细线。依赖 ① 已合并的语法树基础（装饰已语法树驱动）。

## Requirements（来自 parent PRD 需求 1、12-15）

1. 编辑区快捷操作按钮栏：上下用两条细线包住（不再裸在外面）
12. 标题：输入 # 号时，# 的大小跟随标题级别（1 个 # 很大、2 个 # 略小，以此类推）
13. 无序/有序列表与行首有间距（不顶着行首）；Tab 嵌套后距离更大（层级清晰，当前距离很小）
14. 列表嵌套层级的符号依次变化：实心圆点 → 空心圆点 → 实心方点
15. 软换行：输入超过可见区域时按视口宽度自动换行（现在行尾一直往后延伸）

## Acceptance Criteria

- [x] 1: 工具栏上下各一条细线（border-y border-border，实测 1px），视觉包裹
- [x] 12: 标题标记字号随级别递减（h1 0.9rem → h6 0.6rem，实测 h1 14.4px），非光标行隐藏逻辑不变
- [x] 13: 列表缩进源文本替换为 spacer（深度×0.9em，实测 0.9/1.8/2.7em），Tab 嵌套深度递增
- [x] 14: 嵌套符号：1 级实心圆点 • / 2 级空心圆点 ◦ / 3 级以上实心方点 ▪（实测 •◦▪▪）
- [x] 15: 软换行生效（EditorView.lineWrapping，实测长行自动折行）
- [x] smoke-decorations 新增断言：嵌套符号深度 1/2/3/4 + 缩进 spacer 深度 1/2/3（9 项全绿）
- [x] 回归：ui-smoke 47 项全绿、typecheck/build/smoke/stores 全通过
- [x] 说明：`  1.`（2 空格缩进有序）在 CommonMark 中是平级新列表而非嵌套（标记 `1. ` 需 3 空格），Typora 同标准，Tab 缩进嵌套正常

## Notes

- 依赖 ①（已合并）：12/14 用语法树的 HeaderMark / ListItem 祖先链深度；BulletWidget 加 depth 参数
- 13 方案：行首缩进空白 replace 为空 + ListItem 行 Decoration.line padding-left 按深度递增（源文本零改动）
- 15：EditorView.lineWrapping 扩展（一行配置），验证与 markdownEditorTheme 无冲突
- 12 字号分级参考：与标题内容字号（h1 1.6rem → h6 0.9rem）等比缩小或固定比例
