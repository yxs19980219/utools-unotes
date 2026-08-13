# ② 所见即所得工具栏 —— 技术设计（child of 08-13-editor-performance）

## 1. 背景

① 已提供：语法树驱动装饰（Image/FencedCode/Table 节点 + GFM）、性能基线（5000 行 0.14ms）、
光标行机制。本轮把三个工具栏操作升级为「插入即渲染」：
图片 widget、代码块语言选择器、表格工具条。核心原则：**源码始终是标准 markdown，
所有增强都是显示层替换/编辑快捷操作**（延续「只改显示不改内容」契约）。

## 2. 图片（需求 9）

```
工具栏图片按钮 → utools.showOpenDialog({ filters: 图片, properties: ['openFile'] })
  → 返回路径 → 插入 `![图片](路径)`（光标处）
  → Image 语法树节点 → replace widget 渲染 <img>
```

- widget：`ImageWidget extends WidgetType`，toDOM 建 `<img>`：
  - `src = 路径`（uTools 内 file:// 页面同协议可加载；**需 uTools 实测**，不可用则降级）
  - `onerror` → 替换为占位 div（文件名 + 「图片不可访问」提示 + alt 文本）
  - CSS：`max-width: 100%`、`max-height: 240px`、`object-fit: contain`、圆角边框
  - `eq(other)`：比较 src（内容变化时 DOM 复用/更新）
- 插入 API：`MarkdownInsertApi` 增加 `insertImage(path: string)`？——由工具栏按钮完成
  「选择文件 → 插入」，api 只负责 dispatch 插入 `![描述](path)`，描述默认取文件名（去扩展名）
- 图片路径含空格/中文：markdown 语法 `![](C:\路径\图 1.png)` 括号内空格在 GFM 可用；
  路径含 `)` 时需转义 `%29`——**处理：路径中 `()` 替换为 URL 编码**（简单稳妥）

## 3. 代码块 + 语言选择（需求 10）

```
工具栏代码块按钮 → 插入 ```\n\n```（光标居中）
FencedCode 节点围栏行：开围栏 ` ``` ` + 语言区（CodeInfo）
```

- 开围栏行装饰：` ``` ` dim（现有 fenceMark）+ **语言选择器 widget**（替换 CodeInfo 区域）：
  - 无语言（``` 后直接换行）：widget 显示「选择语言 ▾」
  - 有语言（```ts）：widget 显示语言名「ts ▾」
  - 点击 widget → 弹出语言菜单（项目 Popover + Command 组件复用，**浮层挂在 widget DOM 内**
    需注意：widget 是 CM6 管理的 DOM，Popover 浮层可 append 到 body，锚定 widget 元素）
  - 选择语言 → dispatch 修改围栏行源码：` ``` ` + 语言名（替换 CodeInfo 范围）
- 常见语言列表（静态常量）：`ts/js/python/java/c/cpp/go/rust/sql/html/css/json/bash/md/yaml` 14 种
- 围栏行交互细节：
  - 光标在围栏行时显示语言选择器，非光标行隐藏？——**始终显示**（语言选择器是重要信息；
    但非光标行 ` ```ts ` 已 dim——**设计：非光标行显示语言名（正常字色），光标行显示 ▾ 提示可点**）
  - 语言菜单关闭后焦点还给编辑器
- **关键边界**：CodeInfo widget 替换范围 = [开 CodeMark.to, 行尾)。源码无语言时该范围为空
  （[CodeMark.to, CodeMark.to) 空 replace 不显示）→ 需处理：widget 替换「空区间」不渲染，
  改为替换开围栏 CodeMark 之后到行尾的非空区间；无语言时替换范围为 [CodeMark.to, CodeMark.to)
  无法渲染 → **方案：无语言时也替换行尾区域**：widget 替换 [CodeMark.to, 行尾)，
  row 尾无文本时替换空区间 = 不可行。**修正：语言选择器 widget 替换 [CodeMark.to, 行尾)，
  该区间文本为空时**用 `Decoration.replace({ widget, ... })` 替换空区间同样不显示。
  **最终方案：只替换非空 CodeInfo；无语言时在围栏行行首（CodeMark 前）加「+ 语言」提示 widget？**
  简化：**无语言时不动**（用户可选：直接输入语言名后跟换行），有语言时显示语言名 + ▾ 可点。
  工具栏插入代码块时默认带语言？——**插入 ` ```ts\n\n``` ` 默认 ts**，用户可点选更换，避免空态。
  点击语言名 → 菜单（含「无语言」选项，选后移除 CodeInfo）。

## 4. 表格（需求 11）

**核心决策：源码编辑 + 表格工具条，不做 contentEditable widget**（CM6 与 contentEditable
冲突风险高、撤销/IME 难控；Typora 亦是源码编辑 + 快捷操作）。

- 插入：工具栏表格按钮 → `| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |`
  （3 列 2 行，光标落第一数据行）
- **表格工具条**（新交互）：光标所在表格块 → 表格首行上方显示悬浮工具条（或表格块内行首）：
  - 按钮：`➕行` `➖行` `➕列` `➖列`（小 icon 按钮）
  - 点击 → 源码 dispatch：
    - 加行：最后一个数据行后追加 `| 空 | 空 | 空 |`（列数 = 当前表头列数）
    - 删行：删除光标所在数据行（仅剩表头+分隔行时禁用）
    - 加列：每行追加 ` | 空`；表头 `| 新列N`；分隔行 `| ---`
    - 删列：每行移除最后一列（列数 > 2 才可删）
  - 实现：纯文本操作（行级 splice），**不依赖 DOM 表格**；操作后装饰自动重建
- 工具条渲染方案：**表格行装饰中，TableHeader 行行首加 widget**（工具条按钮组）？
  widget 只能单元素——用一个容器 widget（div 内含 4 个按钮 + 事件）。
  **光标行机制**：仅光标所在表格显示工具条（非光标表格不显示，减少干扰）——
  widget 的显示/隐藏由装饰重建控制（cursorLine 参数传进 addTable）。
- 行号定位：删除/插入行需要知道光标所在行 → 光标行号 → 该行属于哪个表格块
  （语法树 resolveInner 找 Table）→ 表格各行列边界（TableHeader/TableDelimiter/TableRow 节点位置）
- 单元格内 `|` 转义：内容含 `|` 时需 `\|`——**MVP：不处理转义**（用户自担，输入时可见源码）

## 5. 通用原则（需求 8）

- 现有 wrap/行级按钮已即时渲染（标记淡色 + 内容样式）✓ 保持
- 本轮三个增强项补齐图片/代码块/表格的「插入即渲染」
- 全部操作后编辑器 `view.focus()` 保持编辑连续性

## 6. 性能与风险

- 图片 widget：按需渲染（仅插入的图片），无性能风险；`eq` 复用 DOM
- 表格工具条 widget：仅光标所在表格 1 个 widget，可忽略
- 风险：Popover 浮层在 widget 内的 z-index/定位（锚定 widget 元素，append body）；uTools 内 file:// 图片加载待实测
- 回滚：各增强为独立装饰分支，git 打点可单功能回退

## 7. 测试

- smoke-decorations 新增：Image 节点 → img widget 断言（headless 用 data URL 路径模拟）
- 表格工具条：headless 交互测试（点击加行/删列 → 源码断言）
- ui-smoke 回归 + bench 性能不回退
