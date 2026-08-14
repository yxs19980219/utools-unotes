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

---

## Session 3: 编辑器换型 CM6 即时渲染（Obsidian 式，重新调研）

**Task**: 08-14-editor-cm6-research

**背景**：用户反馈 Milkdown (CrepeBuilder) 体验差（输入卡顿/源码被改写/观感不简洁/难定制），
要求换 CM6 + 自研，对标 Obsidian Live Preview。经重新调研拍板：atomic-editor 0.6.2 低层组合
+ 自研 KaTeX 公式 + 从零重建（不复用旧 AtomicEditor）。

**关键决策与实现**：
- 根因：Milkdown/ProseMirror 文档=AST（星号被吃掉）；CM6 文档=源码字符串，装饰只改视图
- 低层组合自组 EditorView（组件句柄不暴露 view，MarkdownInsertApi 需 dispatch）
- 受控语义：ContentArea 给 NoteView 加 key={activeNoteId} 重挂载（删 draft 重置 effect）
- mathExtension（StateField + 语法树 + KaTeX）：标准 $/$$；block widget 不替换换行符
- underlineExtension（ViewPlugin）：<u> 标签隐藏 + mark 下划线；==高亮== 由 atomic 内置

**踩坑（调试发现）**：
- block widget replace 含换行 → Enter 后 selection 丢失，输入窜到文档开头（去 to+1 修复）
- CM6 markdown 续行：> / - 后 Enter 自动续行标记，测试用 Backspace 退出引用
- CM6 虚拟化渲染：.cm-line 仅可视行，长文档断言不能数 DOM 行数
- atomic 非光标行隐藏转义符（\$ 的 \ 隐藏），边界断言走 store 源码

**验证**：ui-smoke 50/50、smoke:editor 32/32、数据层 smoke 全过、typecheck/build 绿、
dist 解压 1.68 MB（≤5MB）

### Status

[OK] **Completed**（待提交）


## Session 3: 编辑器即时渲染优化 + 发版 1.6.1

**Date**: 2026-08-14
**Task**: 编辑器即时渲染优化 + 发版 1.6.1
**Branch**: `main`

### Summary

修复 CM6 即时渲染编辑器 6 项体验问题（列表标记分层+缩进、禁用 setext、引用恒隐藏、工具栏去占位、宽度/公式微调），采用 patch-package 对 @atomic-editor/editor 0.6.2 打最小补丁；更新 editor.md 契约；发版 v1.6.1（GitHub Release + tag 已推送）。

### Git Commits

| Hash | Message |
|------|---------|
| `d028c84` | (see git log) |
| `46dc403` | (see git log) |
| `748bdb5` | (see git log) |

### Status

[OK] **Completed**
