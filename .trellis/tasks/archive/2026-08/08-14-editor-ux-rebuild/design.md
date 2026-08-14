# 设计：CM6 即时渲染（atomic-editor + mathPlugin）回滚与集成

## 总体策略

```
git revert 79a0425            # 恢复 CM6 基线（CodeMirrorEditor/装饰/widget/MarkdownView/ui-smoke）
        │
        ▼
CM6 基线 ──集成──▶ new EditorCore（atomic-editor 组件 / 拆散扩展）
                        ├─ 公式：codemirror-live-markdown mathPlugin + blockMathField
                        ├─ 主题：EditorView.theme 映射项目色板（CSS 变量）
                        └─ 只读：atomic readOnly（归档）｜备选 MarkdownView
```

- 回滚是**干净 revert**：79a0425 之后无新提交；revert 同时恢复旧 ui-smoke/大纲 offset 契约，
  新实施不再依赖 Milkdown 选择器。
- 回滚后**先跑一遍基线验证**（typecheck/build/ui-smoke），确认基线健康再集成。

## 边界与契约

### 编辑器内核替换

| 契约 | 基线（CM6 自研） | 新实现（atomic-editor） |
|------|------------------|--------------------------|
| 编辑区组件 | CodeMirrorEditor（@uiw/react-codemirror 壳） | atomic MarkdownEditor（React 组件）或自组 CM6 view |
| 即时渲染 | markdownDecorations.ts（自研，删除） | atomic inlinePreview（成熟实现） |
| 表格 | markdownBlockWidgets.ts（自研，删除） | atomic tables（WYSIWYG 单元格直编） |
| 公式 | 无 | mathPlugin + blockMathField（KaTeX） |
| 代码高亮 | 无 | atomic 内置（fences）或 @codemirror 语言包 |
| 只读态 | MarkdownView（正则，删除） | atomic readOnly（阅读模式） |
| MarkdownInsertApi | CM6 实现（jumpTo=offset） | atomic 暴露的 view + 同一 API 语义 |

### 工具栏/NoteView

- MarkdownInsertApi 接口不变；实现基于 atomic 的 `view` 逃逸口（handle.view）。
- jumpTo(offset)：**恢复 offset 语义**（MetaInfoPanel 随 revert 恢复，无需再改）。
- wrap/block 语义：CM6 文档偏移即 markdown 字符偏移，行为与基线一致。

### 公式扩展（独立封装文件，可替换）

```ts
// src/components/Editor/extensions/mathExtension.ts
import { mathPlugin, blockMathField } from 'codemirror-live-markdown'
export function mathExtension() {
  return [mathPlugin, blockMathField]   // 与 atomic extensions 并列挂载
}
```
- 需求：行内 `$...$`、块级 `$$...$$`（注意 live-markdown 的块级约定，README 称
  "block math must be on a single line"——用 `$$x$$` 单行形式）。
- 若与 atomic inlinePreview 冲突（装饰区间重叠），退路：自研轻量公式扩展
  （lezer math block + KaTeX widget，参考 Strata/modern-markdown-editor 模式）。

## 关键设计决策

### D1: atomic-editor 组件 vs 拆散扩展

优先用 **React 组件（@atomic-editor/editor）**（受控/事件/只读开箱即用），
extensions prop 挂公式。若组件约束太多（如受控 value 要求），改用拆散扩展
（inlinePreview/imageBlocks/tables/atomicEditorTheme + 自组 CM6）——原型二选一。

### D2: 主题

- 优先：自定义 `EditorView.theme` 映射项目 CSS 变量（--background/--foreground 等，
  复用 milkdownTheme.css 的思路改名移植）。
- 深浅色：html.dark 作用域变量（与现有 next-themes 机制一致）。

### D3: 只读态

- 首选 atomic readOnly（渲染一致 + 交互少一套）。
- 备选：保留 MarkdownView（若 readOnly 与公式/表格渲染冲突）。
- 原型验证后定（O3）。

### D4: 代码高亮语言选择

- atomic 内置 fences 渲染；语言选择：编辑器内语言标签浮层（若 atomic 无，用
  CM6 语言选择扩展或回到"工具栏+源码编辑语言标签"最小方案）。

## 兼容与回滚

- 存储格式不变（纯 markdown）；回滚 = revert 集成 commit。
- 分阶段 commit：① revert+基线验证 ② 内核替换+公式 ③ 只读/主题/清理 ④ 测试与体积。
- 风险：atomic 0.6.x API 变化 → 锁定版本（package.json 精确版本）。

## 部署/体积

- 预计 dist 解压 1.5-2MB（CM6 系 + KaTeX + lowlight），原型实测（O4）。
- KaTeX 仅保留 woff2 字体可再省 ~0.6MB。
