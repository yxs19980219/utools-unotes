# Design：Vditor IR 编辑区重构

## 1. 架构总览

```
NoteView
├─ 头部行：← 返回 | 大标题(text-lg) + 标签组(text-xs 紧跟、flex-wrap)
├─ MarkdownToolbar（border-y 细线上下包住）
│    └─ 右侧 ⓘ 圆形按钮 → MetaPopover（时间/字数/大纲）
├─ VditorEditor（Vditor IR 实例，非受控）
│    ├─ npm vditor（index.min.js + index.css 进 bundle）
│    └─ 运行时资源本地化 public/vditor/dist/...（Lute / hljs 子集 / i18n）
│         ← options.cdn = '/vditor' 指向
└─ 归档只读：现有 MarkdownView（不变）
```

- **替换**：`CodeMirrorEditor.tsx` + `markdownDecorations.ts` 删除；`@uiw/react-codemirror`、`@codemirror/*` 依赖卸载
- **新增**：`VditorEditor.tsx`（引擎封装）、`MetaPopover.tsx`（元信息+大纲）、`scripts/build-hljs-subset.mjs`（高亮子集构建）
- **修改**：`NoteView.tsx`（布局+保存链路）、`MarkdownToolbar.tsx`（insertMD + ⓘ）、`public/preload/services.js`（文件选择/读取，仅 uTools 需要的能力）、`scripts/ui-smoke.mjs`（编辑器断言）

## 2. 资源本地化（离线必需，禁止 CDN）

vditor 初始化会动态 `addScript` 加载以下资源，默认走 unpkg，必须本地化：

| 资源 | 来源 | 体积(raw) | 处理 |
|---|---|---|---|
| Lute 引擎 lute.min.js | node_modules/vditor/dist/js/lute/ | 3.6MB | 复制到 public/vditor/dist/js/lute/ |
| 代码高亮 highlight.min.js | 自建（hljs ESM 子集 10 语言） | ~132KB | scripts/build-hljs-subset.mjs 构建 → public/vditor/dist/js/highlight.js/ |
| i18n zh_CN.js | node_modules/vditor/dist/js/i18n/ | 2.5KB | 复制 |

- 目录结构模拟 vditor CDN 布局（`${cdn}/dist/js/...`），`options.cdn = '/vditor'`
- hljs 子集：hljs@11（devDependency）core + javascript/typescript/python/json/markdown/css/xml/bash/cpp/java，esbuild/rolldown IIFE 打包挂 window.hljs（vditor 依赖全局 hljs 调用 highlight/highlightAuto）
- 语言下拉列表收敛：`options.preview.hljs.langs` 配上述语言（vditor 3.x 支持自定义 langs）
- 子集构建产物**提交进仓库**（public/ 属插件内容），构建脚本幂等可重跑

## 3. VditorEditor 组件契约

```
props: { initialValue, onInput(value), onSave, placeholder }
ref API（MarkdownInsertApi 扩展）: insertMD(md), focus()
```

- 实例化：`new Vditor(el, { mode:'ir', cache:{enable:false}, cdn:'/vditor', toolbar: [] (隐藏自带工具栏，用项目 MarkdownToolbar), counter:false, outline:…(不用自带侧栏), preview:{hljs:{…}}, after 回调抛 ready 状态 })`
- **非受控**：`initialValue` 仅首次 setValue（after 回调里），noteId 变化（重开笔记）时 `setValue(content, true)` 重置 + clearStack；输入走 `input` 回调 → `onInput(value)`，**不 setState**
- 保存链路改造（NoteView）：`draftRef` 保留，删除 `draft` state 与 `setDraft`（击键不再触发 React 重渲染 = 流畅度根因修复）；防抖 500ms + 卸载 flush + Ctrl+S（vditor keydown 回调捕获 ctrl+s → onSave）不变
- vditor 自带 focus/undo/redo 快捷键保留（Ctrl+B/I 等由 vditor 内置处理）
- 只读（归档）不实例化 vditor，走 MarkdownView（现状）

## 4. 工具栏所见即所得（MarkdownToolbar 改造）

全部走 `vditor.insertMD(md)`（IR 模式将 md 转 IR DOM 插入并渲染，当前行显示源码、离开隐藏——所见即所得）：

| 按钮 | insertMD 内容 |
|---|---|
| 加粗/斜体/删除线 | `**x**` / `*x*` / `~~x~~`（有选区则包选区，无选区插入占位） |
| 标题 | `# 标题`（循环 1-3 级） |
| 无序/有序/任务列表 | `- ` / `1. ` / `- [ ] ` |
| 引用/行内代码/分割线 | `> ` / `` `x` `` / `---` |
| 代码块 | ` ```lang\n\n``` `（语言占位默认空，IR 渲染后自带语言下拉，用户可直接选） |
| 表格 | `| col1 \| col2 |\n| - \| - |\n|  |  |`（IR 渲染真实表格，单元格点击编辑，Ctrl+± 类快捷键增删行列——vditor 内置，issue #322/#904 确认） |
| 图片 | 见 §5 |

- 选区处理：vditor `getSelection()` 取选中文本；无选区用占位文本并 insertValue 后定位光标（实现细节以 vditor API 为准，插入后 focus）

## 5. 图片插入（base64 内嵌，已确认）

```
点击图片按钮
 ├─ uTools 环境：utools.showOpenDialog({filters:[图片类型]}) → 路径
 │    → preload 暴露 readFileBase64(path)（uTools 有 readFileBase64 API；若无则 services.js 用 Node fs 读，最小权限）
 └─ dev/浏览器：<input type="file" accept="image/*"> → FileReader
 → dataURL 校验/大小限制（≤10MB，超限 toast 拒绝）
 → vditor.insertValue(`![名称](data:...base64...)`) → IR 立即渲染显示
```

- preload/services.js 从空壳扩展：`window.services.showOpenImageDialog()` + `readFileBase64(path)`，**仅 uTools 环境存在**（`typeof utools !== 'undefined'` 时挂载；dev 用 file input 兜底，与 db.ts 的 isUtoolsAvailable 模式一致）
- 迁移/备份：base64 内嵌于正文，无外部依赖

## 6. MetaPopover（ⓘ 面板）

- 触发：工具栏最右圆形感叹号按钮（Badge/Button 圆形样式）
- 内容：
  - 创建时间 `formatTime(note.createdAt)`、更新时间 `formatTime(note.updatedAt)`
  - 字数：`vditor.getValue().replace(/\s/g,'').length`（打开面板时计算；实时性足够）
  - 大纲：数据源 = vditor 内部大纲。实现：Popover 打开时读取 `vditor.outline.element`（Outline 实例已随内容渲染）的 DOM 克隆渲染；点击项 → 定位：IR DOM 中标题节点带 `data-block-id`，`scrollIntoView` + 光标定位（Selection/Range 到标题首字符）。若 vditor 大纲 DOM 结构不稳定，fallback：自己从 markdown 解析 `^#{1,6} ` 行构建列表 + 按行号定位（vditor 无公开"跳转到行"API，需用 IR 节点查找，实现时验证并取舍）
- 只读态：不显示工具栏 → ⓘ 不进只读态（只读态头部保持标题+标签，删「更新于」后无其余信息；如需元信息再迭代）

## 7. 内容区 CSS 定制（markdownDecorations.ts 删除后，样式职责移交 vditor 主题 + 覆盖层）

新建 `src/index.css` 追加（或 `editor-overrides.css` 引入）：

- **标题 # 大小跟随**：IR 当前行标题源码 marker 节点（`code.vditor-ir__marker`，位于 heading 块内）字号按级别覆盖（h1 级 marker 最大 → h6 最小），与渲染层 h1-h6 字号同比例；需实现时先确认 IR heading 节点 DOM 结构（vditor-ir__node[data-type=heading]），fallback 用通用 `.vditor-ir__node[data-type="heading"] .vditor-ir__marker` + 相邻选择器
- **列表**：`.vditor-reset ul { padding-left: 1.5em; list-style: disc } ul ul { list-style: circle } ul ul ul { list-style: square }`（实心圆→空心圆→实心方点）；ol 同理缩进；Tab 嵌套（IR 内 tab 默认缩进）后渲染层层级自然递增
- **软换行**：vditor IR 内容区默认 word-wrap（验证，缺失则补 `white-space: pre-wrap; word-break: break-word`）
- **主题联动**：main.tsx 已有 matchMedia 切换 html.dark；VditorEditor 用 MutationObserver 监听 `documentElement.classList` 的 dark 变化 → `vditor.setTheme(dark ? 'dark' : 'classic')`；vditor 主题色用 CSS 变量覆盖（--vditor-* 映射项目 token，浅色/深色两套），使工具栏/内容区视觉与 shadcn 一致
- **工具栏细线**：MarkdownToolbar 容器 `border-y border-border`，h-9 左右内边距，按钮 ghost/icon-sm

## 8. 依赖变更

- 新增 dependency：`vditor@^3.11.3`
- 新增 devDependency：`highlight.js@^11`（子集构建）、`esbuild`（子集构建，项目已用 rolldown？vite 8 内置 rolldown——用 `npx rolldown` 或 vite build 独立入口构建子集，避免新依赖；implement 阶段定）
- 移除：`@uiw/react-codemirror`、`@codemirror/lang-markdown`、`@codemirror/state`、`@codemirror/view`

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| IR 表格无悬浮工具条（只有快捷键） | 已与用户确认接受；验收含快捷键操作 |
| 大纲跳转依赖 vditor 内部 DOM | §6 fallback（自解析 markdown + 节点定位） |
| hljs 子集构建产物与 vditor 加载契约（全局 hljs + ?v= 后缀） | 子集构建脚本输出挂 window.hljs；实现时按 vditor 实际加载路径/参数对齐 |
| uTools webview 对 vditor 的兼容 | 无特殊 API 依赖，contenteditable 原生能力；ui-smoke 覆盖 |
| vditor 自带 chrome（toolbar/status）干扰 | toolbar: []、counter 关闭、CSS 隐藏多余元素 |
| 回滚 | 代码回退该提交即可；数据格式（markdown 文本）无迁移，无兼容层 |

## 10. 不做（本轮）

- 公式/图表/mermaid 渲染（vditor 能力但体积成本高，不开）
- 图片拖拽/剪贴板粘贴上传（vditor 默认支持粘贴，但走 base64 内嵌策略需验证；MVP 仅按钮入口）
- 只读态元信息 ⓘ、编辑器字体设置、打字机模式
