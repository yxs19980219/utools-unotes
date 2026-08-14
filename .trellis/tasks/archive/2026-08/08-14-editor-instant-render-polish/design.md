# 设计：编辑器即时渲染优化

## 1. 方案总览

6 项需求分三类落地：

| 需求 | 实现层 | 是否动 node_modules |
|---|---|---|
| R1 宽度 | `atomicTheme.css` 覆盖 `.cm-content` | 否 |
| R2a/R2b/R4 列表标记+缩进+引用光标行 | patch `@atomic-editor/editor` 的 `inline-preview.js` | 是（patch-package） |
| R2c/R3 setext 禁用 | `AtomicEditor.tsx` 的 `markdown()` 配置 | 否 |
| R5 工具栏占位 | `MarkdownToolbar.tsx` | 否 |
| R6 公式高度 | `atomicTheme.css` | 否 |

## 2. 关键决策：改 node_modules 的方式

R2a/R2b/R4 埋在 atomic 的 `inline-preview.js`（dist 未压缩、含注释）：
- R2a 圆点：`BulletWidget` 单例固定 `•`，无 depth 信息（第 220-237、581 行）
- R2b 缩进：`LIST_LEVEL_EM = 0.6` 常量（第 321 行），内联 `padding-left: Xem`
- R4 引用：`QuoteMark` 走 `HIDEABLE_SYNTAX` 的 `shouldHide = !activeLines.has(lineNum)`（第 438-459 行），光标行揭示源码

**已排除的方案**：
- 纯 CSS：圆点是 textContent 字符（CSS 无法改字符/按 depth 区分）；缩进是动态内联 style。
- 自研 ViewPlugin 覆盖：CM6 多个 `Decoration.replace` 覆盖同一区间会冲突（bullet widget 已被 atomic replace）。

**采用：patch-package**。改动仅 3 处，最小聚焦。
- 新增 devDependency `patch-package` + `postinstall` 脚本。
- `package.json` 将 `@atomic-editor/editor` 从 `^0.6.2` 锁定为 `0.6.2`（精确版本，防补丁失效）。
- 补丁文件提交到 `patches/`，`npm ci`/`npm install` 后 postinstall 自动重放。

**trade-off**：atomic 升级需重打补丁（有明确的 postinstall 失败提示）；换来最小改动、不动上游源码。备选 fork `inline-preview.js` 到项目（复制 ~1000 行 + `tree-progress.js`/`read-only.js`），维护成本更高，仅当 patch-package 不可行时启用。

## 3. 各需求实现细节

### R1 编辑区宽度
`atomicTheme.css` 追加（覆盖 inline-preview.css 的 70ch 居中）：

```css
.atomic-cm-editor .cm-content {
  max-width: none;
  margin-inline: 0;
  padding-inline: 0.75rem;
}
```

内容占满可用宽度，仅留 0.75rem 内边距（不再居中留白）。

### R2a 列表圆点分层
patch `inline-preview.js`：
- `BulletWidget` 增加 `depth` 构造参数，`eq` 按 depth 比较，`toDOM` 按 `['•','○','▪'][depth % 3]` 渲染。
- 删除单例 `BULLET_WIDGET`，ListMark 的 bullet 分支改为 `new BulletWidget(depth)`（depth 取自已有的 `listItemDepth(listItem)`）。

### R2b 缩进
`LIST_LEVEL_EM` 由 `0.6` → `1.2`（每层缩进加倍；depth0/1/2 实测 2em→2em/3.2em/4.4em）。

### R2c / R3 setext 禁用
`AtomicEditor.tsx` 第 160-164 行：

```js
markdown({
  base: markdownLanguage,
  codeLanguages: CODE_LANGUAGES as LanguageDescription[],
  extensions: [highlightMarkdown, { remove: ['SetextHeading'] }],
}),
```

`@lezer/markdown` 的 `MarkdownConfig.remove` 移除 `SetextHeading` block parser，`文本\n-`、`文本\n====` 不再解析成标题（`文本` 保持段落）。`---` 单独一行的 HorizontalRule 不受影响（独立 parser）。

### R4 引用/勾选语法符号彻底隐藏
patch `inline-preview.js` 的 `HIDEABLE_SYNTAX` 处理，`else` 分支前插 QuoteMark 特判：

```js
else if (node.name === 'QuoteMark') {
  shouldHide = true; // 引用标记光标行也隐藏（对齐列表标记 ListMark/TaskMarker 已恒隐藏的行为）
}
else {
  shouldHide = !activeLines.has(lineNum);
}
```

勾选框 `- [ ]` 已由 ListMark/TaskMarker 恒隐藏（探针确认），无需改；实现时补验证用户报告的「保留 -」场景。

> 范围说明：仅引用 `>` 改为恒隐藏。标题 `#`、粗体 `**`、链接等仍保持 atomic 默认「光标行揭示源码」（Obsidian 标准行为）。如需全部恒隐藏，后续可扩展。

### R5 工具栏占位文字
`MarkdownToolbar.tsx` 中 8 个 wrap 工具的 `placeholder` 参数（`加粗文本`/`斜体文本`/`下划线文本`/`删除线文本`/`高亮文本`/`code`/`公式`/`链接文字`）全部移除 → `wrap(before, after)`。无选中时生成 `****`、`<u></u>`、`$$`、`[](url)` 等空符号 + 光标居中（`markdownInsertApi.ts` 已实现 `anchor: from + before.length`）。

### R6 公式高度
`atomicTheme.css` 的 `.cm-math-block` padding `0.4em 0` → `0.1em 0`。

## 4. 数据流与契约

- 全部为**视图层**改动（装饰/CSS/parser 配置），不改文档内容。
- round-trip 字节级一致契约保持：setext 禁用只改解析（`====` 仍是源码文本，只是不渲染成标题）；列表/引用/勾选仍保留源码字符（装饰替换不写回文档）。
- `MarkdownInsertApi` 接口不变；`NoteView`/`MetaInfoPanel` 零改动。

## 5. 兼容性

- `@atomic-editor/editor` 锁定 `0.6.2`；补丁针对该版本 dist 源码。
- 只读态（归档）沿用 `readOnlyExtension`，列表/引用渲染逻辑与编辑态一致（无 activeLines 分支差异，R4 改动对只读无副作用）。

## 6. 风险与回滚

- **patch 失效**：atomic 升级后 postinstall 报错提示重打补丁。锁定精确版本规避。
- **缩进过大**：`LIST_LEVEL_EM=1.2` 深嵌套（≥3 层）padding 达 5.6em，窄窗口可能过宽——若用户反馈再回调到 1.0。
- **回滚**：删除 `patches/` 与 postinstall 脚本、还原 AtomicEditor.tsx / atomicTheme.css / MarkdownToolbar.tsx 的 git 改动即可整体回退。
