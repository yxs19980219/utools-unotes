# CodeMirror 所见即所得工具栏与编辑器渲染优化——技术设计

## 1. 设计目标与边界

本设计固定以下产品决策：

- `note.content` 继续保存标准 Markdown 字符串，Markdown 是唯一持久化真相。
- 外层 CodeMirror 6 继续是唯一主编辑器；React 不持有逐字符的表格/代码块 UI 状态。
- 标题、列表、行内格式、图片和代码块视觉效果继续使用 Live Preview 装饰。
- 表格升级为跨行 block widget，显示真实 `<table>`；单元格编辑时挂载 nested CodeMirror，变化偏移回外层文档。
- 代码块 MVP 是独立视觉代码区域，但输入仍由外层 CodeMirror 承载；不额外挂载 nested code editor。语言选择器改围栏 info，代码高亮作为可插拔增强，不阻塞表格交付。
- 不直接改 CodeMirror 管理的 content DOM，不把正文改存 HTML/JSON，不引入运行时兼容层。

## 2. 模块边界

```text
① → ② → ③ → ④ → ⑤
```

① `NoteView` / `MarkdownInsertApi`：编辑器生命周期、工具栏命令、自动保存回调。
② `CodeMirrorEditor`：外层 `EditorView`、Markdown/GFM parser、keymap、稳定 extensions。
③ `markdownDecorations`：标题/列表/行内/图片/轻量代码块装饰；只负责 view projection。
④ `markdownBlockWidgets`：StateField、表格范围解析、TableWidget、nested cell editor 生命周期。
⑤ `markdownTableModel`：纯 Markdown 表格 parse / serialize / row-column operations。

### 2.1 React 层

- `NoteView` 保留现有 `draftRef → handleChange → updateNote` 保存链路。
- `CodeMirrorEditor` 继续通过 `@uiw/react-codemirror` 挂载，但 `extensions`、`basicSetup`、imperative API 保持稳定引用。
- nested cell editor 不进入 React state；其变化直接 dispatch 到外层 `EditorView`，外层 `onChange` 再触发已有保存链路。
- `MarkdownToolbar` 不操作 DOM；新增 `insertTable` / `insertCodeBlock` 等命令时仍经 `MarkdownInsertApi`。

### 2.2 轻量装饰层

保留 `markdownDecorationExtension` 的 ViewPlugin，用于不改变垂直结构的装饰：

- 标题级别和内容字号；
- 粗体、斜体、链接、行内代码；
- 列表标记、任务复选框、引用、分隔线、图片；
- 代码块内容的等宽字体/背景；
- 代码围栏和语法标记的隐藏/淡化。

表格不再由该层渲染整行背景或行首操作条，避免旧装饰与 block replacement 重叠。表格工具条迁入 TableWidget 内部。

### 2.3 Block decoration StateField

新增 block widget 扩展，核心原则：

- 用 `syntaxTree(state)` 定位 `Table` 节点，生成 `[node.from, node.to)` 的 block replacement decoration。
- 该 decoration 由 `StateField` 直接提供给 `EditorView.decorations`，不能继续只放在 ViewPlugin 的间接 decorations 中。
- 只对通过表格模型校验的完整 GFM 表格创建 widget；输入中的半成品保留原始 Markdown，避免光标被吞掉。
- StateField 在 transaction 中映射旧 ranges；文档变化、结构性 effect 或 parser 更新时重新计算。
- 明确 `atomicRanges` 行为：表格整体默认是原子块，点击单元格由 widget controller 打开 nested editor；删除/选中整个表格时仍可通过外层 transaction 操作原始范围。

## 3. 表格数据模型与同步

### 3.1 表格模型

`markdownTableModel` 负责：

- 表头、分隔行、数据行、列对齐信息；
- `\\|` 转义管道符与反斜杠处理；
- 不规则行归一化；
- 每个单元格的 source range 与 editable range；
- 从模型序列化为稳定的 GFM Markdown（单元格左右一个空格）；
- 增删行列及最小边界判断。

表格模型是纯函数，不依赖 DOM、React 或 CodeMirror View。现有 `src/lib/tableOps.ts` 的简单行操作只能保留给兼容 smoke 或迁移为模型操作，不再承担嵌套编辑器所需的范围计算。

### 3.2 TableWidget

`TableWidget` 保存当前表格文本、外层范围、模型和稳定内容 hash，职责包括：

- `toDOM(view)` 使用 `view.dom.ownerDocument` 创建容器和真实 `<table>`，不使用全局 document；
- 以 `textContent` 创建普通单元格内容，避免未经清洗的 HTML；
- 表头、数据行、列对齐、空单元格和不规则输入有确定显示；
- 每个单元格携带逻辑坐标（header/body、row、col）和外层 editable range；
- 提供行/列操作工具条；破坏性删除按现有项目规范使用明确 aria-label，边界时禁用；
- `destroy(dom)` 关闭并清理所有 nested editor、事件监听、ResizeObserver；
- `estimatedHeight`、ResizeObserver 和 `requestMeasure` 作为长表滚动稳定性措施；必要时实现 `coordsAt` 将外层逻辑位置映射到单元格矩形；
- 结构变化导致列/行数量变化时重建 DOM；单元格连续输入时优先 `updateDOM`，保留当前 nested editor 和焦点，不能每个字符销毁重建整个表格。

### 3.3 Nested cell editor

单元格进入编辑态的流程：

```text
① → ② → ③ → ④ → ⑤
```

① 点击单元格或按键导航选中逻辑 cell。
② 解析当前 state 得到最新 editable range。
③ 在 cell 容器中创建单行 nested `EditorView`，初始 doc 为 cell Markdown 内容。
④ nested transaction 通过 offset changes 转成 outer transaction，并附带 `syncAnnotation`。
⑤ outer update 重新解析/序列化，更新 widget；当前 cell 仅做增量同步，不重置光标。

规则：

- Tab：移动到下一单元格；最后一个单元格自动追加一行并进入新单元格。
- Shift+Tab：移动到上一单元格；第一单元格时退出到表格前的外层位置。
- Enter：移动到同列下一行；最后一行自动追加一行。
- Escape：结束单元格编辑，将焦点还给外层编辑器并定位到表格范围。
- MVP 不支持单元格内多行 Markdown；Shift+Enter 不改变表格行结构，行为在实现阶段固定为退出/忽略并补充 UI 提示，避免把换行误解析为新表格行。
- 外层文档被工具栏、撤销或其他位置修改时，nested editor 通过最新 cell range 重新定位；若所在表格已删除，先销毁 nested view，不向过期 offset 写回。
- 父子同步必须使用自定义 `syncAnnotation` 或等价标记，防止 outer update 与 nested update 互相触发循环。

## 4. 代码块设计

### 4.1 视觉呈现

- `FencedCode` 继续由 Lezer 定位。
- 代码内容行使用 line/mark decoration 设置等宽字体、背景、内边距和软换行。
- 非编辑上下文隐藏开闭围栏和 info 字符串；光标进入代码块时恢复必要源码标记，保证 Markdown 可编辑和光标定位。
- 语言选择器放在开围栏行；已有 `CodeInfo` 用 replace widget，无 info 时在 `CodeMark.to` 使用 point widget，选择语言时插入 info 字符串而不是依赖空范围 replace。
- 工具栏默认插入带语言的围栏，并将光标放入围栏内的空内容行；围栏前缀与闭合标记之间必须保留空行，避免用户输入与闭合标记粘在同一行。
- 语言变化只修改外层 Markdown info；当光标位于代码块开围栏行时，其他块级插入命令统一定位到代码块结束位置，避免把表格嵌入代码内容。

### 4.2 语言支持

第一阶段保留当前常见语言列表，保证语言选择与 Markdown 往返；若需要语法高亮，再接入 `@codemirror/lang-markdown` 的 `codeLanguages`，优先使用按需加载的 `LanguageDescription`，不一次性打包所有语言。代码高亮不可影响表格/编辑核心或导致 uTools 旧内核构建失败。

## 5. 工具栏和图片

- 点击工具栏时使用 `pointerdown`/`mousedown` 保留外层 selection，再 dispatch 命令，避免按钮抢焦点后插入位置丢失。
- `insertTable` 插入最小有效表格并把逻辑焦点置于第一数据单元格；表格 widget 在同一 transaction 后立即出现。
- `insertCodeBlock` 插入独立围栏块并把光标置于代码内容；不直接插入裸文本后等待预览切换。
- 图片继续复用 `utools.showOpenDialog` 和浏览器 file input 降级；ImageWidget 保持 `src/alt/eq` 契约，禁止 widget 内修改 DOM；uTools `file://` 需在 UI smoke 之外做真实环境验收。

## 6. 数据流、焦点和撤销

```text
① → ② → ③ → ④
```

① 用户输入/工具栏/表格单元格操作。
② 外层 `EditorView.dispatch` 产生标准 Markdown transaction；nested 输入先做范围偏移和 sync annotation。
③ `onChange` 得到完整 Markdown 字符串，NoteView 更新 draft 并防抖保存。
④ 重新进入笔记时只从 `note.content` 恢复，widget/nested 状态全部重新派生。

- Markdown 事务是唯一可撤销对象；表格结构操作作为一个外层 transaction，单元格连续输入按正常输入历史分组。
- widget 仅是 view projection，不在 toDOM/updateDOM 中写入外层 doc。
- 外层 editor 的 controlled value 只用于切换笔记/外部重置；输入期间不让 React 逐字重建 `EditorState`。
- 失败保存仍沿用现有 toast/草稿保留行为，不把 widget 临时状态写入数据库。

## 7. 性能与安全

- 轻量装饰继续使用 Lezer 增量解析和现有全量遍历基线；表格 block widget 只处理可见/已解析的有效表格，避免 React 全文渲染。
- 长表通过 `estimatedHeight`、ResizeObserver、`updateDOM` 和横向滚动容器保持布局稳定；不在 widget 内使用无限 MutationObserver 或频繁 innerHTML 重建。
- 表格 cell 默认以 `textContent` 渲染；若后续支持单元格 Markdown HTML，必须使用明确的安全 renderer/DOMPurify，禁止直接拼接用户 HTML。
- 图片保留现有路径策略，必要时增加安全 URL/协议校验；不因渲染失败向正文写占位文本。
- 全部颜色、边框、间距和字体使用项目现有 semantic token；TableWidget 的 DOM 样式通过 `markdownEditorTheme` 或 scoped CSS 统一，不引入独立视觉体系。

## 8. 依赖决策与兼容性

- 官方 CM6、Lezer、`@uiw/react-codemirror` 继续复用现有版本。
- 已对 `@markwhen/codemirror-tables@0.1.1` tarball 做初步兼容性审查：正式入口是 `createTableExtension`，README 存在命名漂移；Node/headless import 会因模块初始化阶段依赖 `DOMPurify.addHook` 而失败，包内还带有 Joplin 风格渲染假设。因此不将其作为正式运行时依赖。
- 正式实现采用项目内最小 `markdownBlockWidgets`，只参考该包/Joplin 的表格模型、nested editor 和测量策略；这不是重复实现整个 Markdown 编辑器，而是只实现当前产品的 GFM 表格契约。
- 不引入 Vditor/ProseMirror/Milkdown；它们属于已被用户否决的数据/编辑器模型迁移路线。

## 9. 回滚与发布

实现按独立提交拆分：轻量渲染回归、代码块、表格模型、block widget/nested editor、工具栏/UI 测试。任一表格 widget 回归可回滚到当前“源码表格 + 工具条”实现；不修改数据库 schema，因此无需 migration 或数据回滚。最终合并前必须通过 typecheck、build、smoke、UI smoke 和 uTools 图片/输入实测。
