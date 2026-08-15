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

## Session 4: 编辑器交互与样式修复（6 项）

**Date**: 2026-08-15
**Task**: 编辑器交互与样式修复（引用删除、高亮、下划线标签、标题间距、公式块、功能区联动）
**Branch**: `main`

### Summary

修复 6 项编辑器问题：1) 空引用行 Backspace 一次退出（自定义 handler 兜底 deleteMarkupBackward 的语法树依赖）2) ==高亮== 背景由近黑 20% 改黄色 token（--editor-highlight，浅 #fde047 / 深 #ca8a04）3) <u> 标签按光标 reveal（光标在区间内显示标签）4) 标题字号增大（h1 1.7em）+ 分割线移至 padding 区内（与上下文各留 ~0.2em）5) 公式块点击归属校验（posAtCoords 反查，修复相邻块点击错位）+ 移除 minHeight 依赖 CM6 块高度测量（间距与源码行数解耦）6) 工具栏联动（onActiveFormat 上报光标格式，13 项按钮红色高亮）。

### 踩坑（调试发现）

- **RangeSetBuilder 必须按 from 递增 add**：条件分支导致 7,10 在 3,7 之前 add → 构建异常、整个装饰静默失效（页面无报错，`<u>` 无下划线样式）
- **CM6 block widget 高度会被测量**（HeightMapBlock.setMeasuredHeight）：移除 minHeight 后多行块渲染 1 行高，点击/方向键/Enter/滚动均正常——原「必须 minHeight 对齐 N 行」结论过时
- **block widget DOM 溢出**（KaTeX 内容 > 1 行）：溢出区点击命中上方块 DOM → 用 view.posAtCoords 反查点击归属，不在本块区间则不拦截
- **Fast Refresh 陷阱**：EditorView 实例在 useEffect 中创建，改扩展模块后 HMR 不重建实例（旧 keymap/装饰仍生效），验证需刷新页面或新建页面
- **playwright 断言防抖竞态**：store 读的是防抖落盘值，操作后需 waitForFunction 等 store 变化再断言；evaluate 内 console.log 不输出到 Node stdout

**验证**：smoke:editor 32/32、ui-smoke 50/50、数据层 smoke 全过、typecheck 绿

### Status

[OK] **Completed**（待提交）
- **Prec.high 不是独占的**：lang-markdown 的 markdownKeymap 也是 `Prec.high(keymap.of(...))`
  （markdown() 内部第 424 行）且配置位置更早——同优先级按配置顺序，insertNewlineContinueMarkup
  会先消费 Enter（空引用行也返回 true 续行），自定义 Enter/Backspace handler 永远轮不到。
  必须用 **Prec.highest** 才能先于 markdown 的 keymap 执行。
- **insertNewlineContinueMarkup 续行后光标在 `>` 与尾随空格之间**（`>| ` 非行尾）——
  引用退出判定用「光标在 `>` 标记之后」而非「恰为行尾」。
- **`--atomic-editor-accent-bright` 被光标（.cm-cursor/caretColor）使用**：改成彩色会让
  光标变色——高亮底色等彩色样式必须直接引用独立 token，不复用该变量。
- **uTools 内核 Chromium 108 不支持 color-mix()**（Chrome 111+ 才支持）：高亮背景等
  彩色样式在 108 里整条声明失效 → 「背景没渲染、文字还是黑色」。修复模式：
  `.cm-atomic-highlight { background: rgba(...); background: var(--editor-highlight-45); }`
  ——普通属性双写时，旧内核中 var 展开 color-mix 非法 → 该声明被丢弃 → 回退 rgba 行
  （自定义属性 --* 不校验值，双写变量无效——后声明胜，项目 --editor-muted-* 同模式）。
  深色 108 需 `.dark .cm-atomic-highlight` 显式 rgba 兜底（.dark 内变量同样被 color-mix
  后声明覆盖）。
- **IME（keyCode 229）会吞掉 Enter 的 keydown**：中文输入法确认候选时 Enter 的
  keyCode=229，CM6 的 ignoreDuringComposition 忽略 keymap → 退化为浏览器默认换行 →
  空引用行 Enter 退出失效（Backspace 无 IME 竞争所以正常）。headless/Playwright
  合成键盘无法复现（真实键盘才有）——排查此类问题先做 Backspace/Enter 二分。
- **最终防线（transactionFilter）**：在事务层拦截「光标位于空引用行 + 单字符 `\n`
  插入」→ 改写为「剥离 `> ` + 换行」——覆盖 keymap 之外的默认换行路径（Enter 229 /
  真实键盘 DOM change）。严格条件（selection 在插入点、单字符 \n、无其他 change）
  保证不误伤普通换行/粘贴/多行输入。keymap 正常时事务不含裸 \n，互不干扰。
- **最终修复：patch @codemirror/lang-markdown 的 insertNewlineContinueMarkup**（patches/
  @codemirror+lang-markdown+6.5.2.patch，版本锁定精确 6.5.2）：在「连续两个空引用行
  才退出」分支前插入「单空引用行（`>` / `> `）Enter 直接退出」——与项目自身 keymap
  （Prec.highest）+ transactionFilter 组成三层保险（keymap → 续行函数内部 → 默认换行
  事务），任何路径下空引用行 Enter 都退出引用。
- **⚠️ vite 依赖预构建缓存**：改 node_modules 包（patch-package 应用后）dev server 不会
  自动重新预构建——必须重启 dev server（或 --force），否则加载旧模块（症状：src 改动
  生效、依赖改动不生效；页面刷新无效）。uTools dev 模式排障先重启 dev server。
- **patch-package 手动生成 patch**：npm 网络失败时 `npx patch-package` 无法自动生成——
  手动写 git diff 格式 patch，注意 hunk 行数必须与实际内容精确匹配（`@@ -250,9 +250,18 @@`），
  写完用 `npx patch-package`（重放所有 patches/）验证可应用。
- **R1 引用退出回退（用户决定）**：三层保险（keymap Prec.highest + lang-markdown patch +
  transactionFilter）在用户 uTools 真实环境仍无效，用户接受 atomic 默认行为（空一行退出），
  决定回退引用 Enter 退出相关全部修改：恢复任务前 exitBlockquoteOnEnter（Prec.high 原版，
  本就不生效）+ 删除 Backspace handler/transactionFilter + 删除 lang-markdown patch +
  恢复 package.json ^6.5.2。**经验：真实环境（uTools webview + IME + 真实键盘）与 headless
  合成键盘存在无法复现的差异，多轮「修复→验证→用户仍失败」循环时应尽早与用户确认回退或
  接受默认行为，避免过度工程。**


## Session 4: 编辑器交互与样式修复（高亮/下划线/标题/公式块/工具栏联动）发版 1.6.3

**Date**: 2026-08-15
**Task**: 编辑器交互与样式修复（高亮/下划线/标题/公式块/工具栏联动）发版 1.6.3
**Branch**: `main`

### Summary

修复 5 项编辑器问题：==高亮== 黄色渲染（含 uTools 108 内核 rgba 兼容）、下划线标签光标 reveal、标题字号与分割线间距、公式块相邻点击归属修复与间距统一、工具栏格式联动高亮。引用 Enter 退出经多轮排查（keymap 优先级/IME 229/patch）后用户决定回退，接受 atomic 默认行为。发版 v1.6.3（tag + GitHub Release + SourceNote zip）。

### Git Commits

| Hash | Message |
|------|---------|
| `bfa503f` | (see git log) |
| `637d2a9` | (see git log) |

### Status

[OK] **Completed**
