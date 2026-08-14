# Design：Milkdown 编辑器核心迁移

## 1. 架构与边界

```
┌── src/components/Editor/ ──────────────────────────────────────────────┐
│  MilkdownEditor.tsx      React 壳（契约同 AtomicEditor，改名后 NoteView  │
│                          仅改 import 行）                               │
│    ├─ MilkdownProvider + useEditor 装配：                               │
│    │   commonmark + gfm + latex + placeholder + 2 自研 mark             │
│    │   + listener + codeBlockComponent + Mod-s keymap + 只读 config     │
│    ├─ markdownInsertApi.ts  MarkdownInsertApi 的 ProseMirror 实现       │
│    ├─ plugins/highlightMark.ts   ==高亮== mark（schema+解析+序列化）     │
│    ├─ plugins/underlineMark.ts   <u> 下划线 mark                        │
│    ├─ milkdownTheme.css         官方主题 + 变量覆盖（对齐项目 token）    │
│  MarkdownToolbar.tsx      不变（仅 import 路径）                        │
└─────────────────────────────────────────────────────────────────────────┘
  NoteView.tsx / MetaInfoPanel.tsx   结构性改动：import 路径 + 大纲跳转传参
```

- 依赖新增：`@milkdown/kit`、`@milkdown/react`、`@milkdown/crepe`（latex/placeholder feature）
- 依赖保留：`katex`、`@codemirror/lang-*`（代码块 languages）、`@codemirror/state/view`（codeBlock extensions）
- 依赖移除：`@atomic-editor/editor`
- 删除文件：`codeMirrorApi.ts`、`extensions/mathExtension.ts`、`atomicTheme.css`

## 2. 关键设计决策

### 2.1 受控语义（value/onChange 双向）
- **切笔记不依赖 replaceAll**：沿用 `documentId` → React `key={documentId}` 强制 remount（useEditor 重建编辑器），天然隔离光标/undo
- **输入回写**：`listener.markdownUpdated` → `onChange(md)`（保持 NoteView draft 防抖保存逻辑零改动）
- **外部 value 兜底**：`useEffect` 中若 `getMarkdown() !== value` 才 `replaceAll`（正常路径 value 恒等于回写值 → no-op；仅兜底异常路径）

### 2.2 只读
- `editorViewOptionsCtx` 配置 `editable: () => !readOnly`
- NoteView 编辑/只读本就是两个独立实例（readOnly prop 静态），无需运行时切换
- 只读下任务列表勾选框、表格编辑天然不可交互（editable=false）

### 2.3 MarkdownInsertApi → ProseMirror 命令映射

| 工具栏按钮 | 现 CM6 语义 | Milkdown 实现 |
|---|---|---|
| 加粗 `**` / 斜体 `*` / 删除线 `~~` / 内联代码 `` ` `` | wrap | `toggleMark`（strong/em/strike/inline_code），重复点击撤销 |
| 下划线 `<u>` | wrap | `toggleMark`(underlineMark)，重复点击撤销 |
| 高亮 `==` | wrap | `toggleMark`(highlightMark)，重复点击撤销 |
| 链接 | wrap `[x](url)` | `toggleLink`（选中文本变链接） |
| 行内公式 `$` | wrap | 插入 `math_inline` 节点（光标处） |
| 图片 | insertImage 源码插入 | 插入 `image` 节点（alt=文件名、src=path），光标移至图后 |
| h1-h3 `#` | 行首插入/替换级别 | `setBlockType(heading, {level})` |
| 无序/有序列表 | 行首 `- `/`1. ` | `wrapInList`；已在同列表内 → `liftListItem` |
| 勾选框 | 行首 `- [ ] ` | `wrapInList(taskList)` + 默认未勾选 |
| 引用 `>` | 行首 | `wrapInBlockquote`；已在引用内 → 退出 |
| 代码块 ` ```ts ` | 插入围栏 | `setBlockType(code_block)` + `language` 属性 |
| 公式块 `$$` | 插入围栏 | 插入 `math_block` 节点 |
| 表格 | 插入 GFM 源码 | 插入 `table` 节点（3 行 2 列骨架，gfm schema 构建） |
| 分割线 | 插入 `---` | `insertNode(horizontal_rule)` |

**MarkdownInsertApi 接口签名不变**，`wrap`/`block` 内部按 before 字符串识别语法分派。

### 2.4 大纲跳转契约改造（唯一对外语义变更）
- 现状：`onJump(offset)` 传 markdown 源码字符偏移 → WYSIWYG 下源码偏移 ≠ 文档位置
- 改造：`MetaInfoPanel.onJump(item: OutlineItem)` 传完整大纲项（level + text），`NoteView.handleJump` 透传，`api.jumpTo` 改为：遍历 ProseMirror doc 的 `heading` 节点，匹配 level 且文本包含/等于 outline.text 的第一个节点 → `TextSelection` 定位 + `scrollIntoView`
- 重复标题：取第一个匹配（与现版 offset 定位行为一致——现版 offset 也定位到第一个同文本标题）

### 2.5 自研 mark：==高亮== / <u>
- 插件结构（milkdown kit 插件三件套）：
  - schema：`$mark('highlight')` / `$mark('underline')`（prosemirror mark schema）
  - parser：remark `textNodeEnter` 或 useRemarkPlugin 正则切分（`==x==` → mark + text）
  - serializer：`toMarkdown` 输出 `==x==` / `<u>x</u>`（保证 AC12 roundtrip）
- 注：<u> 走 mark 而非 HTML 节点——解析时 `textNodeEnter` 拦截 `=x=` 段，<u> 的 markdown 源是 HTML 内联标签，需解析器把 `<u>…</u>` 识别为 mark（remark inline html + 正则抽取）

### 2.6 公式（latex feature）
- 优先方案：直接 `.use()` 引入 `@milkdown/crepe/feature/latex`（调研确认其依赖 remark-math + katex，语法 `$…$`/`$$…$$` 与现版一致）
- 验证点（implement 步骤 1 先行验证）：feature 是否独立可 use（不依赖 crepe 整体）；若依赖 crepe slice 则改用 CrepeBuilder 仅挂 latex 一个 feature，或按 crepe 源码自研精简版（schema math_inline/math_block + remark-math + KaTeX 渲染）
- 交互：光标进入公式节点显示源码（原生 leaf 行为，D3 已拍板）

### 2.7 主题（D1：官方主题 + 变量覆盖）
- 引入 `@milkdown/crepe/theme/common/style.css` + `classic.css`（浅）与 `classic-dark.css`（深），`.dark` 作用域切换
- `milkdownTheme.css` 覆盖官方 `--crepe-color-*` 变量 → 项目 token（--foreground/--muted/--ring/--primary 等），沿用现有「rgba 行先声明、color-mix 行后覆盖」的 Chromium 108 兼容策略（对齐 atomicTheme.css 既有做法）
- 代码块语法高亮：官方 classic 主题自带中性配色，必要时覆盖对齐现版灰阶（--atomic-editor-hl-* 近似值）
- 保留 `--editor-muted-35/45/55/60` 语义变量复用（index.css 已有）

### 2.8 代码块
- `codeBlockComponent` + `codeBlockConfig`：`languages` 传现有 CODE_LANGUAGES（@codemirror/lang-js/ts/css/html/md 的 LanguageDescription 数组），`extensions` 传 `indentWithTab` + 现有 CM6 扩展
- 语言选择 UI 用组件默认（下拉）；无代码围栏语言标签 → 默认无高亮

### 2.9 其他
- **Ctrl+S**：prosemirror keymap `Mod-s` → onSave()（NoteView window 监听兜底已存在，不动）
- **placeholder**：借用 `@milkdown/crepe/feature/placeholder`，text = 现版文案，mode 沿用默认
- **task list 勾选**：gfm preset 自带（input rule `[ ] `/`[x] ` + 点击 toggle 命令）；验证编辑态点击勾选、只读不可点

## 3. 兼容性与迁移

- 存量笔记 markdown 无需迁移（milkdown 解析标准 markdown + GFM + `$`公式 + `==`/`<u>`）
- roundtrip 保真约束（AC12）：序列化规则必须输出与源码等价语法——mark 序列化、math、表格、任务列表、图片语法逐项验证
- 已知差异（接受）：markdown 序列化会规范化格式（如 `**` 与 `__` 统一、列表缩进），内容不丢即可
- 图片本地路径：现有 `pickImageFile` 产出 f.path（uTools）/ blob URL（浏览器），`image` 节点 src 直接承载，渲染保持

## 4. 风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| crepe latex/placeholder feature 独立 use 失败 | 中 | implement 步骤 1 先做最小 demo 验证；备选 CrepeBuilder / 自研精简版 |
| `==`/`<u>` 解析与 roundtrip 偏差 | 中 | 插件解析/序列化成对验证（smoke 用例） |
| 官方主题观感与现版差异 | 低 | 变量覆盖逐项对照现版截图验收（AC10） |
| 大纲跳转文本匹配歧义 | 低 | level+text 匹配 + 取第一个（行为与现版一致） |
| roundtrip 丢内容 | 中 | AC12 用例：公式/表格/图片/任务列表/高亮/下划线逐项 |

- 回滚：git 提交粒度按 implement 步骤推进；内核替换作为独立提交，回滚即 revert 该提交（旧文件删除与替换同提交，不写兼容层）

## 5. 不做的事（边界）

- 不引入 slash / block（拖拽）/ AI / 块手柄菜单
- 不引入源码-预览双栏
- 不重构 NoteView 保存机制与数据模型
- 不引入搜索替换/多光标等新能力

## 6. 历史教训（git 79a0425 → 94cbfec → 8c7afc6）

- 2026-08-14 曾用 **Crepe 完整框架**迁移 Milkdown（ui-smoke 53/53、smoke:editor 29/29 全过），
  但**用户否决「Milkdown (Crepe) 块编辑体验」**后回滚，改用 atomic-editor（CM6）Live Preview。
- 本方案与历史否决点的差异：
  - 不用 Crepe 完整框架（其默认启用 BlockEdit 块手柄），改用 CrepeBuilder 只装配
    codeMirror/latex/placeholder/listItem，**明确排除 block-edit / slash / 拖拽**
  - 用户本次需求即「纯 markdown 编辑交互 + 即时渲染、不要斜杠命令、不要拖拽」，
    与历史否决的「块编辑体验」正相反，方案已按要求规避
  - 历史方案改大纲跳转为「序号 index」，本方案改为按 level+text 匹配标题（语义更强）
- 验收时需对照验证：**无块手柄/无斜杠菜单**（smoke R11 已覆盖）
