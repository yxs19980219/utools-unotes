# CodeMirror 所见即所得工具栏与编辑器渲染优化

## Goal

让笔记编辑器在保持 Markdown 内容可保存、可导出的前提下，达到“按钮按下即可看到格式效果”的即时编辑体验：工具栏插入代码块和表格后直接显示可操作的视觉组件，正文中的标题、列表等 Markdown 语法按规则即时渲染，且输入、光标移动、滚动不出现明显卡顿或布局跳动。

本任务已完成 CodeMirror 6 生态与现有实现调查，按已批准的 Markdown 源文本真相 + CodeMirror block widget 方案执行。

## Implementation baseline (before this task)

- 笔记正文当前以 `note.content: string` 保存，编辑器使用 CodeMirror 6 + `@uiw/react-codemirror`。
- Markdown 解析使用 `@codemirror/lang-markdown` 与 `@lezer/markdown` 的 GFM 扩展；当前已有语法树驱动装饰、图片 Widget、代码块语言选择器和表格行列操作工具条。
- 当前装饰通过 `ViewPlugin` 全量构建 `DecorationSet`；已有装饰主要是 `mark`、行内 `replace` 和行首 Widget，不是跨多行的真实表格/代码块编辑组件。
- 当前表格操作改写 Markdown 行文本，表格单元格仍由外层 CodeMirror 源码直接编辑；当前代码块内容使用等宽背景装饰，语言选择器改写围栏信息字符串。
- 当前 `typecheck`、`build`、`smoke:decorations`、`smoke:tableOps` 基线通过；未将“真实表格 DOM + 单元格编辑”和“独立代码块编辑器”作为验收覆盖。
- 项目已有设计 Token、shadcn/ui、Lucide、Playwright UI smoke 和装饰器 headless smoke；不应重复引入已有能力。

## Requirements

### R1. 工具栏即时呈现

工具栏按钮执行后，用户应直接看到对应的格式化视觉效果，而不是只看到裸 Markdown 语法。源码可在光标所在编辑上下文中按需显露，但不能出现“点击后先闪过一段裸语法、需要切换预览才看到效果”的流程。

### R2. 代码块

点击代码块按钮后插入一个独立的视觉代码区域，并可持续输入代码、删除、复制和撤销；MVP 不强制额外挂载第二个 CodeMirror 实例，代码输入由外层 CodeMirror 文档事务承载。代码块可选择常见编程语言，选择语言后视觉代码区域与保存的 Markdown 围栏信息保持一致。

### R3. 表格

点击表格按钮后插入真实表格视觉组件。表头和单元格可直接编辑；用户可通过明确的交互新增/删除行列，结构变化应反映到保存的 Markdown 表格文本；Tab、Shift+Tab、Enter 等常见表格编辑操作的范围需在方案中明确。

### R4. 图片

图片按钮打开 uTools 文件选择器（浏览器开发环境提供可测试降级），插入后直接显示图片；图片路径、失败显示、最大尺寸和 Markdown 兼容性需保留现有契约。

### R5. 内容区渲染

- 标题：输入合法标题语法后，标题内容按 1~6 级呈现递减字号；标题标记在编辑上下文中可编辑，离开后不应破坏标题视觉层级。
- 列表：`-`、`*`、`+` 或有序列表标记只有在满足 Markdown 语法（包括标记后的空格）后才渲染为列表；单独输入标记时仍是普通文本。
- 列表间距：列表不贴行首；Tab 嵌套后层级缩进明显增加，嵌套符号层级清晰。
- 其他已有即时渲染（粗体、斜体、链接、任务列表、引用、分隔线、软换行）不得回归。

### R6. 数据与编辑体验

- 保存的数据格式、已有 Markdown 笔记兼容性、复制/粘贴与撤销语义必须在方案中明确，不得以不可逆的 HTML/JSON 替换现有正文而未获确认。
- 代码块、表格、图片等视觉组件不能通过直接修改 CodeMirror 管理的 DOM 来模拟编辑；用户输入必须最终落为受控的 CodeMirror 文档事务。
- 800×600 uTools 窗口下无横向页面溢出；长文档输入、滚动和光标移动需维持现有性能基线或给出可量化的回归门槛。

## Acceptance Criteria

### 方案交付

- [x] 完成现有 CodeMirror 6 数据流、装饰层、工具栏、保存链路和测试基线调查，并记录文件/符号证据。
- [x] 调查官方 CodeMirror 6 / Lezer Markdown 机制，以及可复用的 CM6 Markdown live-preview、表格编辑、代码块编辑相关库；记录版本、依赖、成熟度、许可证、与现有依赖的兼容性和已知风险。
- [x] 至少比较：继续增强现有 CM6、自研 StateField/Widget 方案、复用 CM6 表格扩展/社区 live-preview 方案、切换为 AST/WYSIWYG 编辑器方案；明确推荐方案与不推荐原因。
- [x] 输出 `design.md`：组件边界、文档数据流、事务同步、装饰来源（ViewPlugin/StateField）、表格/代码块编辑模型、焦点与撤销、性能、回滚策略。
- [x] 输出 `implement.md`：分阶段执行顺序、验证命令、风险点、验收流程和 rollback 点。
- [x] 对用户待决策项逐项给出推荐项与取舍；在进入实现前阻塞性决策为空，并获得用户对最终规划摘要的明确批准。

### 产品行为验收（供后续实现使用）

- [x] 代码块按钮插入后直接出现可输入代码区域，并可选择常见语言；保存后 Markdown 围栏信息可往返。
- [x] 表格按钮插入后直接出现可编辑真实表格；至少支持增删行列，结构修改可往返为 Markdown。
- [ ] 图片按钮选择图片后直接显示图片，路径和失败场景不污染正文源码（浏览器/headless 已覆盖，uTools `file://` 仍待实测）。
- [x] 标题、列表空格触发、列表缩进/层级、软换行和已有 Markdown 渲染契约全部通过 headless/UI smoke。
- [x] 输入、滚动、光标移动无明显卡顿或跳动；5000 行装饰基准不超过项目既定阈值，UI smoke 无 page error/console error。

## Out of scope

- 不切换到 Vditor、Milkdown、Tiptap、ProseMirror 或其他 AST/HTML 文档模型。
- 不改变笔记实体、数据库 schema、uTools 插件入口和自动保存策略。
- 不扩展为 Notion 式块拖拽、协同编辑或全量富文本排版系统。

## Key product decisions

- 持久化真相继续是 Markdown 源文本，不迁移为 HTML/JSON 文档模型。
- 继续使用 CodeMirror 6；表格采用真实 block widget + 嵌套单元格编辑器，所有修改最终通过外层 CodeMirror transaction 回写 Markdown。
- 代码块采用独立视觉代码区域，但 MVP 由外层 CodeMirror 承载输入，不为代码块额外挂载 nested EditorView；只有后续验收证明语言服务/独立焦点是硬需求时才单独升级。
- 用户接受表格单元格进入编辑态时局部显示 Markdown 内容，以换取 Markdown 可往返、撤销可控和不改变正文数据契约。
