# Design —— 编辑器与 UI 七项修复

## 1. 总览与边界

7 项独立修复，全部位于前端（src/ + node_modules 补丁 + 依赖清单）。不涉及数据层 schema 变更（Prefs 加可选字段，向后兼容）。

```
┌─────────────────────────────────────────────────────────────┐
│ 编辑器域（AtomicEditor.tsx + atomicTheme.css + patch）        │
│   ① 粘贴扩展（paste 监听 → data URL 插入）                     │
│   ② 代码语言接入（ATOMIC_CODE_LANGUAGES）+ CodeInfo chip 样式 │
│   ④ 待办完成态灰底   ⑤ 列表符号 depth 样式                    │
├─────────────────────────────────────────────────────────────┤
│ 主题域（src/lib/theme.ts + settings store + SettingsView）   │
│   ③ 三态主题：light / dark / system                           │
├─────────────────────────────────────────────────────────────┤
│ 通用 UI（ui/dialog.tsx + ui/input.tsx）                       │
│   ⑥ 弹窗去描边加阴影；输入框浅灰底无边框                      │
├─────────────────────────────────────────────────────────────┤
│ 搜索域（services/search.ts + App.tsx placeholder）            │
│   ⑦ 去掉 type: 语法                                           │
└─────────────────────────────────────────────────────────────┘
```

## 2. 分项设计

### ① 图片 Ctrl+V 粘贴（AtomicEditor.tsx）

- 在 view 生命周期 effect 内，`view.dom.addEventListener('paste', handler)`，destroy 时移除。
- handler 流程：
  ```
  paste 事件
    → e.clipboardData.items 中找 kind==='file' 且 type.startsWith('image/') 的第一项
    → e.preventDefault()（仅当命中图片）
    → FileReader.readAsDataURL(file) → dispatch 插入 `![图片](data:...)`，光标移至末尾
    → 未命中图片 → 不拦截（走 CM6 默认文本粘贴）
  ```
- 与 `pickImageFile` 浏览器降级一致采用 data URL（避免 blob URL 内存驻留；uTools CEF108 无 `f.path`）。
- 复用 `markdownInsertApi.insertImage` 的路径转义语义（data URL 无 ()，直接安全），直接 dispatch，不依赖 api 引用。
- 风险：极老内核 clipboardData.items 可能为空 → 无图片时保持默认行为，不降级尝试（可接受）。

### ② 代码块高亮 + 语言标签（依赖 + AtomicEditor.tsx + atomicTheme.css）

- 依赖（新增 11 个，均为 atomic 的 optional peerDependencies）：
  `@codemirror/lang-python lang-go lang-rust lang-java lang-cpp lang-php lang-sql lang-xml lang-json lang-yaml @codemirror/legacy-modes`
- AtomicEditor.tsx：`import { ATOMIC_CODE_LANGUAGES } from '@atomic-editor/editor/code-languages'`（21 种 ≈ TOP20），删除本地 `CODE_LANGUAGES`（与 atomic 重复的 5 种随之迁移）。
- 语言标签（CodeInfo）样式：`t.meta` 被 atomicMarkdownHighlight 染成 `--atomic-editor-fg-faint`（亮色下不可见）。新建 `src/components/Editor/extensions/codeInfoHighlight.ts`：
  ```ts
  syntaxHighlighting(HighlightStyle.define([
    { tag: t.meta, color: 'var(--editor-code-info, #0b66d6)',
      backgroundColor: 'var(--editor-code-info-bg, rgba(0,0,0,0.06))',
      borderRadius: '4px', padding: '0 4px' },
  ]))
  ```
  注册在 `atomicMarkdownSyntax` 之后（后注册的同类 tag 样式覆盖前者）。深色：`.dark` 下变量覆盖为浅蓝 + 半透明白底。CSS 变量定义放 atomicTheme.css（遵循项目 rgba 兜底、不用 color-mix）。
- 亮色 token 色板：在 `.atomic-cm-editor` 定义 `--atomic-editor-hl-*`（GitHub 亮色系深色值：keyword #8250df / string #0a7b36 / number #c4541e / comment #6e7781 / type #953800 / function #0550ae / property #0550ae / regexp-escape-tag #cf222e / variable #24292f / operator #0550ae）。暗色不定义 → 回落 Palenight 默认。
- 验证注意：`@codemirror/legacy-modes` v6.5.x 的子路径 `mode/ruby|swift|shell|toml|dockerfile` 存在（atomic 打包依赖此）。

### ③ 主题三态切换（types.ts + theme.ts + settings store + SettingsView + main.tsx）

- `Prefs` 增加可选字段 `theme?: 'light' | 'dark' | 'system'`；`DEFAULT_PREFS.theme = 'system'`（老文档缺省等价 system，不迁移）。
- 新建 `src/lib/theme.ts`：
  ```ts
  export type ThemePref = 'light' | 'dark' | 'system'
  let cleanup: (() => void) | null = null
  export function setThemePref(pref: ThemePref): void
  // 内部：matchMedia 监听仅当 pref==='system'；pref 变化先清理旧监听再应用
  export function applyThemePref(pref: ThemePref): () => void  // 单次应用，返回清理函数
  ```
- 时序：main.tsx 首帧 `setThemePref('system')`（无闪烁）；App 内 `bootstrapStores().then(() => setThemePref(useSettingsStore.getState().prefs.theme))`。
- SettingsView PrefsBlock 增加「主题」三态 Select（亮色/暗色/跟随系统），保存：`savePrefs({ ...prefs, theme })` + `setThemePref(theme)`。
- smoke-editor AC10（emulateMedia 跟随系统）：默认 system 行为不变，测试不回归。

### ④ 待办完成态灰底（atomicTheme.css）

覆盖 `--atomic-editor-fg-faint` 之上的 `.cm-line.cm-atomic-task-done`：
```css
background: var(--muted);          /* 整行灰底 */
color: var(--muted-foreground);    /* 文字灰 */
text-decoration: line-through;     /* 保留删除线 */
border-radius: 0.3em;
```
行级 background 不影响 CM6 高度测量（行背景不参与布局）。未完成态不动。

### ⑤ 列表符号（patch + atomicTheme.css）

- 更新 `patches/@atomic-editor+editor+0.6.2.patch`：`BulletWidget.toDOM()` 中追加 `span.setAttribute('data-depth', String(this.depth))`。
- atomicTheme.css（注意与现有 `transform: scale(1.3)` 合并）：
  ```css
  .cm-atomic-bullet { color: var(--foreground); transform: scale(1.3); } /* 不变 */
  .cm-atomic-bullet[data-depth="1"] { font-size: 0.72em; }  /* ○ 缩小至与 ● 视觉接近 */
  .cm-atomic-bullet[data-depth="2"] { transform: scale(1.3) translateY(0.08em); } /* ■ 下移居中 */
  ```
  font-size 缩小不改 alcove 固定宽度（0.9em），缩进/包裹对齐不回归。具体字号/偏移以 dev 实测为准。

### ⑥ 弹窗/输入框（ui/dialog.tsx + ui/input.tsx）

- `DialogContent`：`ring-1 ring-foreground/10` → `shadow-lg`（柔和阴影替代描边）。
- `Input`（全局组件）：
  ```
  旧：border border-input bg-transparent ... focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
  新：无 border；bg-muted 浅灰底；focus-visible:bg-muted/60 聚焦加深；无 ring；保留 disabled/aria-invalid 语义
  ```
- 影响面：NoteForm / ObjectForm / SettingsView / TagInput 等所有 Input 使用者，效果统一（用户已确认）。

### ⑦ 搜索去 type: 语法（search.ts + App.tsx + smoke-data-layer.ts）

- `tokenize`：删除 `type:` 分支；`SearchTokens` 删除 `sourceType` 字段。
- `searchNotes`：删除 sourceType 过滤段（object 仍用于结果携带，保留）。
- 裸词评分不变（标题 10× > 标签 6 > 正文 2×，符合"标题、标签、正文顺序命中"）。
- App.tsx subInput placeholder：`'搜索：type:book 关键词 #标签'` → `'搜索：关键词 #标签'`。
- smoke-data-layer.ts：删除 `type:` 相关断言（148-163 行附近），tokenize 组合断言改为 `'注意力 #深度学习'`。

## 3. 兼容性与回滚

- 数据：Prefs.theme 可选字段，老数据缺省 → system，无需迁移；搜索语法删减只影响新查询。
- 依赖：新增 11 个 @codemirror 包为纯增量；patch 更新只加属性不改既有行为。
- 回滚点：每个分项独立提交；若某项出问题，revert 对应 commit 即可，无跨项耦合。
- 风险清单：
  - R1：`t.meta` 覆盖范围超出 CodeInfo（URL 等）→ 实施时用 dev 验证，必要时换 patch 方案（给 CodeInfo 加独立 class）。
  - R2：legacy-modes 子路径在安装版本中缺失 → 以实际安装版本验证，缺失则调整列表。
  - R3：CEF108 clipboardData.items 无图片 → 保持默认行为，不引入回归。
  - R4：多 syntaxHighlighting 叠加顺序 → 验证实际渲染，后注册优先。
