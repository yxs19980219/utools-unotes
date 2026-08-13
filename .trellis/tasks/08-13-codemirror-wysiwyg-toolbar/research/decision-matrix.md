# 方案矩阵与初步推荐

## 需求强度拆分

“所见即所得”有两个容易混淆的强度：

1. **Live Preview / 混合编辑**：正文仍是 Markdown 字符串；离开当前编辑上下文后隐藏标记、显示样式；代码块仍由外层 CM6 编辑，表格可以通过工具条改源文本。
2. **真实结构化组件**：表格显示为 HTML table，单元格有独立焦点和键盘导航；代码块是独立 block 区域/嵌套编辑器；按钮操作不让用户接触裸语法。

当前代码已经接近 1，但用户这次的“真实表格（可编辑、可增删行列）”更像 2。两者必须在 PRD 中明确，否则实现完成后仍会因“看起来像表格但其实是源码”产生争议。

## 选项对比

| 选项 | 文档真相 | R2/R3 完成度 | 现有投资 | 复杂度 | 主要风险 | 判断 |
|---|---|---:|---:|---:|---|---|
| A. 继续当前 mark/widget + 行操作 | Markdown | R2 中、R3 弱 | 高 | 低 | 真实表格诉求无法满足 | 只适合降级 MVP |
| B. 自研 CM6 block widget + nested CM6 | Markdown | 高 | 高 | 很高 | 父子事务、焦点、IME、撤销、滚动测量、widget 生命周期 | **推荐作为长期可控方案** |
| C. 参考 `@markwhen/codemirror-tables`，自研代码块 | Markdown | 表格高、代码块中 | 中高 | 中高 | Node import 依赖浏览器 DOM，且带 Joplin 渲染假设 | **参考结构，不直接依赖** |
| D. 复用 `codemirror-live-markdown` 及模块 | Markdown | 宣称高 | 中 | 中 | alpha、依赖膨胀、真实可编辑行为未在本项目验证 | 仅作为对比/POC |
| E. 切 Vditor IR/WYSIWYG | Markdown（由引擎从 DOM 还原） | 高 | 低 | 中 | 替换编辑器、光标映射、主题/生命周期/接口迁移 | 只有明确放弃 CM6 时推荐 |
| F. 切 Tiptap/Milkdown/ProseMirror | AST/JSON（Markdown 是 I/O） | 高 | 很低 | 中高 | 数据迁移、Markdown 往返差异、失去源码即真相 | 不符合当前数据契约 |

## 推荐分层

### 推荐 0：先做最小 POC，不立即安装包

在当前任务的规划/实现前置阶段，用一个独立的 `scripts` 或临时分支验证三个不可逆风险：

- 由 StateField 提供跨行 block replacement 是否能在当前 `@codemirror/view@6.43.8` 正确布局；
- 表格单元格 nested editor 的文本变更能否偏移映射回外层 Markdown，并保留 undo/redo；
- 代码块是否可以只用外层 CM6 + `codeLanguages` 获得“可输入代码框”，避免为简单代码区引入第二个编辑器。

POC 必须有焦点、撤销、IME、滚动和多表格用例，不能只截图“出现了 table”。

### 推荐 1：短期产品路线

保持 CM6 + Markdown 源文本为唯一持久化真相：

- 标题/列表/粗体/图片/普通代码块继续使用轻量 mark/inline widget；
- 代码块优先采用**外层可编辑 block 的样式化方案**：隐藏围栏、显示代码区、按语言加载语法支持；若用户明确要求独立代码编辑器，再升级为独立 nested view；
- 表格使用 block widget + nested cell editor；已审查 `@markwhen/codemirror-tables` 的结构但不直接引入，按其/Joplin 模式自研当前产品所需的最小实现；
- 所有结构变更最终 dispatch 到外层文档，自动保存仍只消费外层文档字符串。

### 推荐 2：长期可维护路线

若 POC 证明第三方表格包与 uTools/主题/撤销不兼容，则自研一个项目内 `markdownBlockWidgets` 扩展，内部明确四个边界：

```text
Markdown parser
      ↓ ranges + table model
BlockDecoration StateField
      ↓ TableWidget / CodeBlockWidget
Nested editor controller
      ↓ offset changes + sync annotation
Outer EditorView.doc (唯一真相)
      ↓ onChange
NoteView autosave
```

组件内部只负责 DOM 展示和事件；模型/序列化放 `src/lib`；外层事务/焦点协调放 Editor 扩展层；React 只负责生命周期和保存回调。

## 不建议

- 用 `contentEditable` 直接改 CodeMirror widget DOM 并指望外层自动同步；官方 MutationObserver 会回写/撤销 DOM 变化，且撤销/IME不可控。
- 继续在 ViewPlugin 中添加跨行 block replace；它违反 CodeMirror 布局装饰来源约束。
- 将表格内容放入 React state、每次输入重渲染 HTML table；会破坏光标、性能和撤销。
- 为了“看起来像真实表格”把正文改存 HTML/JSON；这会破坏当前 Markdown 兼容和已有笔记。
