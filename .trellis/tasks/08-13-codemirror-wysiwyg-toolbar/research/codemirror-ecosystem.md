# CodeMirror 6 生态与相关实现调查

## 结论先行

CodeMirror 6 本身不是富文本/表格编辑器，而是一个“文档字符串 + 增量状态 + 装饰视图”的编辑内核。它非常适合当前项目的 Typora/Obsidian 式 Live Preview：Markdown 源文档仍然是 `EditorState.doc`，格式标记通过 Decoration 隐藏或淡化，离开编辑上下文后显示渲染效果。

但“真实表格”与“独立代码框”属于跨多行、改变垂直布局、需要内部编辑焦点的组件。CodeMirror 官方机制允许通过 block replacement widget 实现，但必须把布局装饰放进 StateField/直接 decoration facet，并处理嵌套 EditorView、事务偏移、焦点、撤销、滚动测量和销毁。没有一个 CodeMirror 官方包可以直接把这两项需求完整解决。

## 官方 CodeMirror / Lezer 能力

### 1. Decoration 类型

来源：

- https://codemirror.net/docs/guide/
- https://codemirror.net/docs/ref/
- https://codemirror.net/docs/migration/

可用机制：

- `Decoration.mark`：只改变文本样式；适合标题、粗体、列表、代码内容背景。
- `Decoration.replace`：隐藏一段源码或用 `WidgetType` 替换；适合图片、语法标记、完整表格/代码块预览。
- `Decoration.widget`：在文档位置插入 DOM widget；适合工具条、语言选择器、按钮。
- `Decoration.replace({ block: true })`：可替换跨行内容并改变布局，但不能由读取 viewport 后才计算的间接 ViewPlugin 装饰提供。
- `StateField` + `EditorView.decorations.from(field)`：让布局相关装饰在 viewport 计算前可用。
- `EditorView.atomicRanges`：将被替换内容当作原子范围，避免光标/删除穿进不可编辑 widget；真实表格要提供明确的“进入单元格编辑”转接策略。
- `WidgetType` 生命周期包含 `toDOM`、`eq`、可选 `updateDOM`、`destroy`、`estimatedHeight`、`coordsAt`；大型跨行表格如果不处理高度和坐标，容易滚动跳动。

官方明确指出 CodeMirror 管理的 `.cm-content` 有 MutationObserver，不能直接把 widget DOM 改成用户编辑源；用户输入必须由 CodeMirror transaction 完成。把 widget 内容设为 `contenteditable` 只能做临时/局部方案，仍需要把变化同步回外层文档并防止 DOM 变化污染源文档。

### 2. Markdown 解析

来源：

- https://github.com/codemirror/lang-markdown
- https://github.com/lezer-parser/markdown
- Context7：`/websites/codemirror_net`、`/lezer-parser/markdown`

当前 `markdown({ extensions: [GFM] })` 已能获得增量 Lezer 语法树。GFM 节点覆盖表格、任务列表、删除线等；围栏代码结构是 `FencedCode`，其子节点通常是 `CodeMark`、可选 `CodeInfo`、`CodeText`、闭合 `CodeMark`。

`@codemirror/lang-markdown` 的 `codeLanguages` 可以按围栏 info 动态加载语言支持；项目当前只使用 GFM，没有接入 `@codemirror/language-data` 或具体语言包，因此当前代码块是等宽样式而非真正语法高亮。语言选择器与语言高亮可以分开设计：前者改 Markdown info 字符串，后者由 `codeLanguages` 提供。

Lezer 的增量解析适合作为所有装饰和 block widget 的定位基础，但它只给语法树/范围，不替项目解决 HTML 表格渲染、单元格编辑或父子编辑器事务同步。

### 3. `@uiw/react-codemirror`

当前版本：4.25.11。

来源：

- https://github.com/uiwjs/react-codemirror
- https://uiwjs.github.io/react-codemirror/

它提供 `value`/`onChange`、`extensions`、`onCreateEditor` 和 React ref。当前项目已对 `extensions`、`basicSetup`、API 使用 `useMemo`，避免每次 NoteView 渲染触发 reconfigure。

注意：wrapper 的 controlled `value` 外部变化会以整段 document replace 同步；输入期间有 typing latch，但若额外把嵌套编辑器状态通过 React 受控 props 往返，仍可能造成光标/撤销问题。建议外层编辑器保留一个稳定 `EditorView`，父子编辑器同步尽量通过 CM6 transaction 和明确的 sync annotation，而非 React state 逐字驱动。

## 社区实现与可复用价值

### `codemirror-rich-markdoc` 0.0.2

- GitHub：https://github.com/segphault/codemirror-rich-markdoc
- 113 stars，MIT；最后 npm 版本 0.0.2（2024-10）。
- 采用 Lezer + 隐藏语法标记；对表格、引用等复杂块使用 block widget；光标进入块时恢复源码。
- README 已列出图片支持、箭头光标、渲染块重复计算等已知问题。
- 价值：适合研究“光标附近 raw / 其他位置 rich”和 block widget 边界；不建议直接作为生产依赖。

### `codemirror-markdown-hybrid` 1.2.2

- GitHub：https://github.com/tiagosimoes/codemirror-markdown-hybrid
- npm 版本 1.2.2（2026-01-26），MIT；依赖 CM6；仓库规模和社区反馈较小。
- 提供 hybrid preview、标题/列表/表格/代码块/快捷 actions 等概念。
- 价值：可参考 toolbar action 与 raw/hybrid 模式 API；需要先审查源码和真实测试，不应因为 README 覆盖功能就直接替换现有实现。

### `@yuya296/cm6-live-preview-core` 0.1.0

- npm：https://www.npmjs.com/package/@yuya296/cm6-live-preview-core
- 2026-01-12 发布，MIT，只有一个 0.x 版本。
- 只提供按元素切换 rich/raw、隐藏 token 的核心机制，不提供真实表格或代码块编辑。
- 价值：可以参考触发规则（cursor nearby / block）和“view-only decorations”边界；不适合作为完整方案。

### `codemirror-live-markdown` 0.5.1-alpha.1

- npm package 版本为 0.5.1-alpha.1，最后发布 2026-01-18。
- 按模块提供 live preview、表格、可编辑表格、代码块高亮、代码块编辑器、图片等；代码块支持 `auto` / `toggle` source mode。
- 依赖/可选依赖面较大，README 提到 `marked`、`lowlight`/语言包、KaTeX、Mermaid 等能力；当前项目暂未使用这些库。
- 价值：最接近“模块化功能包”的组合方案，但 alpha 版本、依赖膨胀、样式和数据同步契约未知；只能作为 POC 候选，不宜直接承诺生产采用。

### `@markwhen/codemirror-tables` 0.1.1

- npm：https://www.npmjs.com/package/@markwhen/codemirror-tables
- 2026-02-20 的最新 0.1.1，MIT，约 46 weekly downloads，只有 2 个版本，约 342 KB unpacked。
- 精确覆盖本任务的表格形态：HTML table 视觉渲染、单元格嵌套 CodeMirror 编辑、浮动工具条、Tab/Shift+Tab/Enter 导航、增删行列、对齐和单元格格式化。
- 依赖 `@floating-ui/dom`、`style-mod`、`dompurify` 等；声明的 API 文档同时出现 `tableExtension` 与 `createTableExtension` 两个命名，需要安装后通过类型和实际导出核验。
- 实际 tarball 类型核验：正式入口是 `createTableExtension`（README 的基础示例仍写 `tableExtension`）；同时导出 `TableWidget`、表格模型、nested editor controller 和同步事务工具。
- 实际导入核验：Node/headless 直接 import 会在模块初始化阶段调用 `DOMPurify.addHook`，没有浏览器 DOM 时失败；包内还包含 Joplin 风格的 HTML sanitizer、脚注/KaTeX/YouTube 处理等产品假设。浏览器 Vite 是否能稳定打包、uTools 内核是否兼容仍需单独验证。
- 因此本项目不直接把它作为正式依赖；只参考其 `TableWidget`、cell range、nested transaction 和 `syncAnnotation` 结构，正式实现采用项目内最小 GFM 表格扩展，避免把 Joplin 专用渲染和安全策略带入。
- 价值：它证明“Markdown 源文档 + nested CM6 table widget”可行，但成熟度、uTools 内核、现有主题、GFM parser 版本和撤销行为必须由本项目验收，而不能仅信 README。

### `@silkdown/core` / `@silkdown/react`

GitHub README：https://github.com/magarcia/silkdown。其文档描述了 CM6 Live Preview，但截至本次 `npm view`，`@silkdown/core` 尚未在 npm registry 可获取，不能作为现成依赖。

### `codemirror-rich-markdoc`、`codemirror-markdown-hybrid` 等共同结论

社区包主要解决“语法标记隐藏/样式化”，真实表格仍然需要 block widget + nested editor。社区包的 feature list 不能替代对 selection、IME、撤销、滚动和安全渲染的验证。

## 专业项目参考：Joplin / Joplin Rich Tables

来源：

- https://github.com/laurent22/joplin/blob/4dbbf2c3/packages/editor/CodeMirror/extensions/rendering/renderTables.ts
- https://github.com/bwat47/joplin-rich-tables
- https://discuss.codemirror.net/t/nested-editors-kind-of/4654

Joplin 的实现是目前最有价值的架构参考：

- 外层 CM6 文档是 Markdown 唯一真相；表格整体由 block replacement widget 显示为 HTML table。
- 单元格进入编辑态时挂载 nested editor/编辑控制器，内容变化转为外层文档的偏移 changeset。
- 结构操作先解析为 table model，再 serialize 回 Markdown；需要处理转义 `\\|`、不规则列数、表格后空行、滚动位置和 widget 高度缓存。
- `estimatedHeight`、ResizeObserver、`coordsAt`、`destroy` 等用于避免大表格滚动跳跃和孤立 nested view。
- Joplin 的代码量和测试量说明这不是一个“加一个 Widget 就完成”的小改动。

这份实现更适合作为自研方案的设计/测试参考，不建议直接拷贝进本项目：其渲染服务、主题、编辑器状态和产品操作均与 SourceNote 不同。

## 相关论坛结论

来源：

- https://discuss.codemirror.net/t/wysiwyg-table/9763
- https://discuss.codemirror.net/t/nested-editors-kind-of/4654
- https://discuss.codemirror.net/t/how-to-replace-content-with-widget/4288

CodeMirror 作者和社区的共识是：表格视觉编辑通常要使用 block widget，并在其中嵌套多个编辑器；父子编辑器之间需要偏移外层 changeset。布局装饰必须来自 StateField；大型 widget 还要处理高度估计和坐标，否则容易滚动跳动。由此确认：当前 ViewPlugin + 行级装饰方案无法低风险地直接升级为真实表格。

## 非 CodeMirror 备选：Vditor 3.11.3

- npm 最新 3.11.3，2026-08-11 更新；https://github.com/Vanessa219/vditor
- 官方支持 `ir`（类似 Typora）、`wysiwyg`、`sv` 三种模式；GFM 表格、任务列表、代码块、图片、工具栏均是内建能力。
- 优点：最接近“按钮即结果 + 真实表格/代码块”的现成产品；减少自研 block widget 与 nested editor 风险。
- 代价：不再以 CodeMirror 为编辑内核；需要重做 `MarkdownInsertApi`、React/uTools 生命周期、主题 token、元信息跳转、自动保存桥接和 UI smoke；其 DOM→Markdown 光标映射/内容还原是一套新模型。
- 结论：仅当用户确认“真实 WYSIWYG 优先于保留现有 CodeMirror 投资”时作为切换方案，不作为当前 CodeMirror 路线的默认实现。
