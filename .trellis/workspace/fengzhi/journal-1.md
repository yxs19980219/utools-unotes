# Journal - fengzhi (Part 1)

> AI development session journal
> Started: 2026-08-10

---



## Session 1: CodeMirror 所见即所得表格与代码块编辑

**Date**: 2026-08-14
**Task**: CodeMirror 所见即所得表格与代码块编辑
**Branch**: `main`

### Summary

完成 CodeMirror 6 Markdown 所见即所得增强：新增 GFM 表格模型与源码范围解析、StateField 驱动的真实表格 Block Widget、嵌套单元格编辑、Tab/Shift+Tab/Enter 导航、增删行列与撤销；修复代码块插入换行、围栏显示和语言选择器；补充 58 项 UI smoke、headless smoke、性能检查；更新前端编辑器规范并提交 v1.4.0。uTools file:// 图片和中文 IME 仍待真实环境验收。

### Git Commits

| Hash | Message |
|------|---------|
| `c20d547` | (see git log) |

### Status

[OK] **Completed**


## Session 2: Typora 式即时渲染（v1.4.1）

**Date**: 2026-08-14
**Task**: Typora 式即时渲染（v1.4.1）
**Branch**: `main`

### Summary

编辑器即时渲染升级为 Typora 式：代码块改为常驻 nested CM6 的独立输入框（闭合围栏 widget 化、无围栏可见、语言下拉改写源码、round-trip 修复空代码块尾换行漂移）；粗体/斜体/删除线/行内码非光标行零宽隐藏（font-size:0 修复拖选断裂）；表格外框内容宽度自适应 + hover 右上角工具条；color-mix 兼容 uTools Chromium 108 内核（--editor-* 双写变量）；新增 smoke:decor-styles 作为 uTools 内核等价验证通道（Chrome 107），59+12+13 项断言全绿；发布 v1.4.1（tag + GitHub Release）。

### Git Commits

| Hash | Message |
|------|---------|
| `f948532` | (see git log) |
| `8163327` | (see git log) |

### Status

[OK] **Completed**
