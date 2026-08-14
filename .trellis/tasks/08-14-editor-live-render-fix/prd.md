# 编辑器即时渲染问题排查与改进（Typora 式即时渲染）

## Goal

将编辑器即时渲染从"Obsidian 式（标记淡化可见）"升级为"Typora 式（标记完全隐藏、纯所见即所得）"，并修复表格视觉缺陷，使编辑体验达到 Typora 水准。

## Background / Confirmed Facts

### 环境与内核（已实测确认）

- 用户环境：uTools 7.8.0，实际内核 = **Electron 22 / Chromium 108**（从 uTools.exe UA 模板实测；官方 FAQ 的 Chromium 91 已过时）
- 用户加载方式：uTools 开发者工具 + `npm run dev`（http://localhost:5173），dist 仅上架用
- Chromium 108 不支持 `color-mix()`/`oklch()`/`lab()`（需 Chrome 111+）
- dev 模式下 CSS 变量经 Vite/LightningCSS 正确降级为 hex（实测 `--muted=#f5f5f5`、`--border=#e0e0e0` 等）✅

### 内核验证矩阵（实测，dev server 与 dist 分别跑 UI 冒烟 58 项）

| 内核 | 结果 |
|------|------|
| Chrome 91 | 崩（Vite 8 产物语法不兼容） |
| Chrome 107（Vite target 最低线） | 58/58 全过 |
| Chrome 110 | 58/58 全过 |
| uTools 108（107~110 之间） | 必然全过（107 产物为 108 子集） |

### 装饰实际状态（Chrome 107/110 实测计算样式 = uTools 108 行为）

- **粗体**：`.sn-md-bold` font-weight 600 生效 ✅；`**` 标记 `.sn-md-dim`（muted-foreground + opacity 0.45）**可见淡化** → 用户视为"没渲染"（期望完全隐藏）
- **代码块**：非光标行围栏 `.sn-md-hidden` 隐藏、代码区 `.sn-md-codeblock` muted 背景 ✅ → 功能正常；用户看到光标行围栏（编辑态显示是设计行为），且期望 Typora 式视觉
- **表格**：TableWidget 渲染 ✅；边框 ✅；但 `.sn-md-table-widget table { width:100%; minWidth:28rem }` → **创建即占满整行**；工具条 `renderTable` 先 append toolbar 再 append table → **显示在表格顶部**，用户认为丑
- **color-mix 失效点**（真实缺陷）：`.cm-activeLine`、`.sn-md-table-widget`、`.sn-md-table-widget th`、`.sn-image`、`.sn-md-tbl` 系列的背景色在 Chromium 108 上全部丢失（style-mod 运行时注入不经过 Lightning CSS 降级）

### 用户明确诉求（原始描述 + 澄清）

1. "粗体还是显示 **文字**" → 期望 Typora 式：标记完全隐藏，只显示加粗效果
2. "表格很丑：增删行列按钮在开头、创建时就占满整行" → 工具条位置/样式重设计 + 宽度自适应
3. "代码块确实没渲染，想要 Typora 那种效果" → 代码块视觉 Typora 化
4. 基准 = "typora 那种效果"

## Requirements

- R1 行内标记（粗体 `**`/斜体 `*`/删除线 `~~`/高亮 `==`/行内码 `` ` `` 等）按 Typora 式交互隐藏：光标行淡化显示（编辑定位需要）、非光标行完全隐藏——具体交互模型待用户确认（R1 拆 A/B 方案）
- R2 表格视觉：宽度按内容自适应（不再占满整行）；工具条重设计（hover 显示、放角落/底部，不默认占用表格顶部）
- R3 代码块视觉：非光标行完全隐藏围栏（现状已具备，补充验证）；代码块区域视觉 Typora 化（背景/圆角/行距打磨）；光标行围栏+语言选择器保持淡化显示
- R4 `markdownEditorTheme` 中 color-mix/oklch/lab 全部替换为 Chromium 108 兼容写法（语义色变量 + 兼容 fallback），修复真实内核下背景色丢失
- R5 新增 uTools 真实内核（Chromium ≤108 等价，用 puppeteer@19.0.0 的 Chrome 107 或专门 Chromium 108）下的装饰计算样式验证脚本，纳入 smoke

## Acceptance Criteria

- [ ] AC1：非光标行的 `**粗体**` 显示为纯加粗文本（`**` 不可见）；光标行内 `**` 淡化显示
- [ ] AC2：表格宽度按内容自适应（未占满整行）；工具条不默认显示在表格顶部（hover 或角落样式）
- [ ] AC3：代码块非光标行呈现干净代码区域（无围栏、有背景）；与 Typora 观感一致
- [ ] AC4：Chromium 107/110 上 `markdownEditorTheme` 无 color-mix/oklch/lab 声明；表格/活动行背景色正常显示
- [ ] AC5：现有 58 项 UI 冒烟 + 12 项装饰断言继续全过（无回归）
- [ ] AC6：新增装饰计算样式验证脚本在 Chrome 107 上通过（作为 uTools 内核等价验证通道）

## Out of Scope

- 替换编辑内核（vditor 等，08-13 已决策放弃）
- 代码块语法高亮（@codemirror/lang 接入，08-13 已决策延后，不影响本文 AC）
- 图片/公式渲染增强

## Open Questions

1. 行内标记交互模型：A=Obsidian 式（非光标行隐藏、光标行淡化）vs B=更激进 Typora 式（输入后立即隐藏，编辑时临时显示）？——阻塞 R1，待用户决策
2. 表格工具条重设计方向（hover 右上角 vs 底部工具条 vs 右键菜单）？——待用户确认
3. 代码块 Typora 化视觉细节（圆角/边框/语言标签样式）？——待用户确认
