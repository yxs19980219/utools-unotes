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

## Session 2: 编辑器核心迁移 Milkdown（CrepeBuilder）

**Date**: 2026-08-14
**Task**: 08-14-milkdown-editor-migration
**Branch**: `main`

用 Milkdown 7.22.1（CrepeBuilder 装配）替换 atomic-editor/CM6 自研内核，规避历史否决点（Crepe 块编辑体验）：
- 只装配 codeMirror/latex/placeholder/listItem，无 slash / block-edit / 拖拽（R11）
- 自研 ==高亮== / <u> 下划线 mark 插件：remark 转换 + mark schema + 序列化 handlers
  - 陷阱①：split 空串片段 → Empty text nodes（只读/重开解析时暴露）
  - 陷阱②：<u> 被 remark 拆成两个 html 节点，需成对合并
- 公式 $…$/…：math_inline 节点 + LaTeX 代码块预览（Crepe latex feature）
- MarkdownInsertApi 重写为 ProseMirror 命令（19 项工具栏全迁移）
- 大纲跳转契约：markdown 源码偏移 → level+text 匹配 heading（WYSIWYG 下偏移失效）
- 测试注入经验：insertText 的 \n 不成换行、不触发 input rules；快速注入+公式触发
  Position out of range；Ctrl+Enter（exitCode）退出代码块
- 验证：smoke:editor 28/28、ui-smoke 14/14、数据层 smoke 全过、typecheck/build 绿
- 提交：d9dfb6d（含 spec/frontend/editor.md 重写、任务归档工件）

### Git Commits

| Hash | Message |
|------|---------|
| `d9dfb6d` | feat(editor): 迁移 Milkdown (CrepeBuilder) 即时渲染——替换 atomic-editor/CM6 自研内核 |

### Status

[OK] **Completed**
