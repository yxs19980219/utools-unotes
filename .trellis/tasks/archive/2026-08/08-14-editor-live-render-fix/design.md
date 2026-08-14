# 设计：Typora 式即时渲染改造

## 1. 架构与边界

不改动 CodeMirror 核心架构（语法树驱动装饰 + ViewPlugin 全量重建），仅扩展装饰生成逻辑与样式。

```
markdownDecorations.ts（装饰）        markdownBlockWidgets.ts（表格 Widget）
  ├─ addRangeDecorations(cursorLine)    ├─ renderTable（DOM 结构调整）
  │   ├─ addEmphasisLike（新增光标行感知） └─ CSS 工具条 hover 悬浮
  │   ├─ addInlineCode（新增光标行感知）
  │   └─ addFencedCode（已具备光标行感知）
  └─ markdownEditorTheme（color-mix 兼容化）
index.css（@theme 新增半透明语义变量，双写降级）
```

## 2. 行内标记光标行感知（R1，方案 A）

**现状**：`addEmphasisLike`（markdownDecorations.ts:557）无光标行参数，`**` 标记始终用 `dimMark`（淡化可见）。

**改造**：传入 `cursorLine`，非光标行用 `hiddenMark`（`display:none`，与标题 `#` 非光标行隐藏同机制，已验证可行）：
- `StrongEmphasis`（粗体）、`Emphasis`（斜体）→ `addEmphasisLike(builder, node, style, cursorLine)`；非光标行：`hiddenMark` 包裹标记 + 内容样式保留
- `InlineCode`：反引号非光标行隐藏（内容 `.sn-md-code` 样式保留）
- `Strikethrough`/高亮 `==`：GFM 扩展已解析，标记同样处理
- 光标行：保持 `dimMark` 淡化

**注意**：`hiddenMark` 的 `display:none` 不占空间，非光标行文本会无缝拼接（`**粗体**` → `粗体`加粗显示）。光标行重建时机已由 `markdownDecorationPlugin`（docChanged/光标跨行触发）覆盖，无需改动插件本身。

## 3. 表格视觉（R2）

### 3.1 宽度自适应

`markdownEditorTheme`（markdownDecorations.ts:166-171）：
- `.sn-md-table-widget table { width: 100%; min-width: 28rem }` → `width: max-content; min-width: 0`；容器 `overflowX: auto` 保留（超宽时横向滚动）

### 3.2 工具条 hover 右上角悬浮

DOM（`markdownBlockWidgets.ts` renderTable:326-348）保持 toolbar 元素，样式改造：
- `.sn-md-table-widget { position: relative }`
- `.sn-md-table-toolbar { position: absolute; top: 4px; right: 4px; opacity: 0; transition: opacity .15s; pointer-events: none }`
- `.sn-md-table-widget:hover .sn-md-table-toolbar { opacity: 1; pointer-events: auto }`
- 按钮图标化（＋/－ 替代文字），底色 `var(--background)` 半透明提升可读性
- 移除 `borderBottom`，改为悬浮卡片样式（圆角 + 阴影 + border）

纯 CSS hover 实现，无 JS 改动（TableWidget 的 ignoreEvent 已挡事件透传）。

## 4. 代码块 Typora 化（R3）

现状已具备核心机制（非光标行围栏隐藏 + 语言选择器 + muted 背景），视觉增强：
- `.sn-md-codeblock`：圆角 `var(--radius-sm)`、`display: block`（替代 inline-block）、`margin` 上下留白，muted 背景保持
- 围栏行非光标行 `display:none`（现状）；光标行 `dimMark` 淡化（现状）
- 语言选择器（`.sn-lang-picker`）：保持淡化小字样式

## 5. color-mix 兼容化（R4）

**问题**：style-mod 运行时注入样式不经过 Lightning CSS，`color-mix(in oklab, ...)` 在 Chromium 108 全失效（实测：表格/活动行背景为 transparent）。

**方案**：Tailwind 4 的 `@theme` 定义自定义属性会被 Lightning CSS 按 `targets: chrome 88` 降级。新增半透明语义变量（index.css @theme 内）：

```css
@theme {
  --color-muted-35: color-mix(in oklab, var(--color-muted) 35%, transparent);
  --color-muted-55: color-mix(in oklab, var(--color-muted) 55%, transparent);
  --color-accent-45: color-mix(in oklab, var(--color-accent) 45%, transparent);
}
```

- **验证点（实施时必须实测）**：Lightning CSS 是否把 `@theme` 内 color-mix 值降级为兼容形式（`rgb(... / .35)`）；若不降级，回退方案：手动双写（`:root` 内 rgba 行 + color-mix 行，深色模式用 `prefers-color-scheme: dark` 双写 rgba）
- `markdownEditorTheme` 中所有 `color-mix(...)` 改为引用上述变量：
  - `.cm-activeLine` → `var(--accent-45)`
  - `.sn-md-table-widget` → `var(--muted-35)`
  - `.sn-md-table-widget th` → `var(--muted-55)`
  - `.sn-image` → muted 60% → 新增 `--muted-60`
  - `.sn-md-tbl` 系列（旧表格装饰，可一并清理或替换）

**验收**：Chrome 107/110 上 computed-style 断言背景色非 transparent；现代 Chrome 上无回归（新内核仍走 color-mix 原值或降级 rgb 均可）。

## 6. 验证通道（R5）

- `scripts/smoke-decor-styles.mjs`：完整导航 → 输入粗体/代码块/表格 → 断言计算样式（粗体 fontWeight=600、标记非光标行 display:none、代码块 bg 非 transparent、表格宽度非 100%、工具条 hover 可见）
- 运行方式：`BROWSER_PATH=<Chrome107> npm run smoke:decor-styles`（dev server 需运行）
- 与 ui-smoke（58 项）、smoke-decorations（12 项）互补：ui-smoke 查功能/存在性，本脚本查 uTools 内核下的真实样式

## 7. 兼容与回滚

- 改动集中在装饰生成（纯增量）+ 主题样式，不涉及数据层/存储
- `hiddenMark` 隐藏机制与标题 `#` 共用，已验证
- 回滚点：单个文件 revert（markdownDecorations.ts / markdownBlockWidgets.ts / index.css）
- 风险：`display:none` 行内标记在复制/选择时的表现（选择 `**` 隐藏区域会选到整个拼接文本——与标题 # 行为一致，可接受）
