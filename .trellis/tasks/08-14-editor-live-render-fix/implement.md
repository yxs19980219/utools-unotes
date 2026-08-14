# 实施计划：Typora 式即时渲染改造

## 前置

- 参考文件：`markdownDecorations.ts`（装饰+主题）、`markdownBlockWidgets.ts`（表格）、`index.css`（主题变量）
- 验证基线：`npm run smoke:decorations`（12 项）、`npm run ui-smoke`（58 项，dev server 需运行）
- uTools 内核等价验证：Chrome 107（`C:\Users\Fengzhi\.cache\puppeteer\chrome\win64-1045629`）+ `BROWSER_PATH` 环境变量

## 实施清单

1. **行内标记光标行感知**（R1）
   - `addEmphasisLike` 增加 `cursorLine` 参数：非光标行 `hiddenMark` 包裹 `EmphasisMark`，光标行保持 `dimMark`
   - `addRangeDecorations` 中 `Emphasis`/`StrongEmphasis`/`InlineCode` 分支传 `cursorLine`
   - 验证：`smoke-decorations` 现有断言适配 + 新增"非光标行标记 hidden"断言；`smoke-decor-styles` 新增 display:none 断言

2. **表格宽度自适应 + 工具条 hover 悬浮**（R2）
   - `markdownEditorTheme`：`table { width: max-content; min-width: 0 }`；工具条 absolute 右上 + hover 显示 + 图标化
   - 验证：`smoke-decor-styles` 断言表格宽度非 100%、工具条默认不可见 hover 可见

3. **代码块视觉 Typora 化**（R3）
   - `.sn-md-codeblock`：block + 圆角 + 上下 margin
   - 验证：`smoke-decor-styles` 断言代码块 bg/圆角

4. **color-mix 兼容化**（R4）
   - 先在 `index.css` @theme 添加 `--color-muted-35/55/60`、`--color-accent-45`，build 后检查 dist/index.css 降级结果（lightningcss 是否转 rgb）
   - 若不降级：回退 `:root` 双写（rgba 行 + color-mix 行 + dark 模式 rgba）
   - `markdownEditorTheme` 全部 color-mix 引用替换为变量
   - 验证：Chrome 107 `smoke-decor-styles` 断言表格/活动行背景非 transparent

5. **验证通道**（R5）
   - 正式化 `scripts/smoke-decor-styles.mjs`（从本次会话临时脚本完善，入口注释 + 退出码）
   - package.json 增加 `smoke:decor-styles` 脚本

## 验证命令

```bash
npm run smoke:decorations          # 装饰断言（12 项，含新增）
npm run typecheck                  # 类型检查
BROWSER_PATH=.../chrome.exe npm run ui-smoke    # dev server 需运行；现代 Chrome
BROWSER_PATH=<Chrome107> npm run smoke:decor-styles  # uTools 内核等价验证
BROWSER_PATH=<Chrome107> npm run ui-smoke       # uTools 内核等价全量
```

## 风险点 / 回滚

- 行内 `display:none` 后选区行为变化（与标题 # 一致，可接受）
- `@theme` color-mix 降级行为不确定 → 实施第 4 步时先做降级实验，失败走双写回退方案
- 全部改动限 3 个文件（markdownDecorations.ts / markdownBlockWidgets.ts / index.css）+ 1 个新脚本；单文件 revert 即可回滚
