# 设计：Milkdown (Crepe) 编辑器迁移

## 架构总览

```
NoteView（不变：防抖保存 / 只读判断 / 工具栏布局）
  ├─ MarkdownToolbar（UI 不变，19 项）──→ MarkdownInsertApi（实现换 Milkdown）
  ├─ MetaInfoPanel（不变：元信息 + 大纲跳转）
  └─ 新 MilkdownEditor（替代 CodeMirrorEditor，props 契约不变）
       ├─ @milkdown/react 桥接 React ↔ ProseMirror
       ├─ Crepe（WYSIWYG 皮肤：latex/代码高亮/表格/任务列表/slash/block handle）
       └─ 只读态：Crepe readonly 模式（替代 MarkdownView）
```

## 边界与契约

### 组件替换：`CodeMirrorEditor.tsx` → `MilkdownEditor.tsx`

对外契约不变（NoteView 零改动）：

| 契约 | 现状（CM6） | 新实现（Milkdown） |
|------|------------|-------------------|
| props `value/onChange/onSave/placeholder/autoFocus` | CM6 受控 | Crepe `defaultValue` + `onChange(md)` + `getMarkdown()` |
| `MarkdownInsertApi.wrap(before, after, placeholder)` | 字符串包裹 | Milkdown command：选中范围包裹 marks / 插入文本 |
| `MarkdownInsertApi.block(prefix, suffix, opts)` | 行首/块插入 | Milkdown command：按前缀映射（heading/list/task/quote/codeblock/mathblock/table/hr） |
| `MarkdownInsertApi.insertImage(path)` | 插入 `![](path)` | 插入 image 节点（src=path），验证 sanitizer 行为 |
| `MarkdownInsertApi.jumpTo(pos)` | CM6 文档偏移 | remark 解析 md → mdast position 映射标题 → ProseMirror 位置 → scrollIntoView |
| `MarkdownInsertApi.focus()` | CM6 focus | ProseMirror view focus |

编辑器实例经 `useEditor`/`editorRef` 暴露，Api 实现放独立模块 `milkdownApi.ts`。

### 保存链路（不变）

`onChange(md)` → NoteView draft → 500ms 防抖 → `updateNote(content)`。Crepe onChange 自带内部 debounce（默认 500ms，可配）；卸载 flush 依赖 `getMarkdown()` 同步取值（在 unmount 前调用 `editor.action(/* 取当前 md */)`）。

### 废弃删除

- `src/components/Editor/CodeMirrorEditor.tsx`
- `src/components/Editor/markdownDecorations.ts`
- `src/components/Editor/markdownBlockWidgets.ts`
- `src/components/MarkdownView.tsx`（只读态改 Crepe readonly）
- 依赖：`@codemirror/state`、`@codemirror/view`、`@codemirror/lang-markdown`、`@uiw/react-codemirror`

### 新增依赖

`@milkdown/crepe`、`@milkdown/react`、`katex`（Crepe latex feature 必需）。代码高亮优先 Crepe 内置 sugar-high（体积小）；Prism 仅当高亮效果不足时启用（语言模式按需 chunk）。

## 关键设计决策

### 1. Crepe features 配置

```
latex: true            // R1
codeBlock.highlight     // R4（sugar-high 或 prism）
table: true            // 现有表格支持（WYSIWYG 单元格直编）
taskList: true         // R2
blockEdit: true        // 块手柄（Typora 感）
slash: true            // 斜杠菜单（Typora 感）
linkTooltip: true
image: true            // 图片插入
readonly: (只读态)     // R9
```

### 2. 只读态（R9）

`NoteView` 中 `readonly`（归档）分支改用 Crepe readonly 模式渲染 `note.content`，删除 `MarkdownView.tsx`。渲染一致性自动满足（同一内核）。

### 3. 主题适配（R10）

Crepe 主题通过 CSS 变量 `--crepe-*` 定义；在项目现有 `next-themes` 深浅色机制下，提供 `.dark` 作用域覆盖变量，色值取自现有 Tailwind 色板（background/foreground/muted 等）。关闭 Crepe 默认 frame 主题或覆盖之，与 App 视觉统一。

### 4. 源文本规范化（O2，待用户确认）

Milkdown 输出 markdown 由 remark 序列化器生成：`- [ ]` 可能变 `* [ ]`、表格管道对齐/转义风格会规范化。**语义无损**，但格式与手写风格不再逐字保留。确认后接受。

### 5. 工具栏命令映射

`MarkdownInsertApi.block(prefix)` 按 prefix 分发 Milkdown command：
- `#/##/### ` → setHeading；`- ` → bullet list；`1. ` → ordered list；`- [ ] ` → task list；`> ` → blockquote
- ```` ```ts ````、`$$`、表格模板、`---` → 对应插入 command / 文本插入
- wrap 类：`**`/`*`/`~~`/`` ` ``/`==`/`<u>`/`$`/`[` → 相应 mark/命令，无选中插占位并选中

## 兼容与回滚

- 存储格式不变（Markdown 文本），**无数据迁移**；回滚 = 恢复旧编辑器组件 + 依赖（git revert 即可，数据零影响）。
- 风险点实施时先行验证：① 图片 file:// src 显示（sanitizer）；② 深浅色切换下 Crepe 变量覆盖；③ 大文档 onChange 性能；④ 卸载时 getMarkdown 时机。
- 验证手段：现有 `smoke` 脚本（数据层）不受影响；`ui-smoke`（playwright headless）覆盖新编辑器冒烟；手动 uTools 加载 `npm run dev` 验证交互细节。

## 部署/体积

实测上限：dist 解压 3.87 MB（zip 1.82 MB），≤ AC13 阈值。若启用 prism 需保持按需加载（语言 chunk 懒加载）。
