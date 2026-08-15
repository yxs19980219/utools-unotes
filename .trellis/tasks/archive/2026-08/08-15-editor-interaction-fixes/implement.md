# 执行计划：编辑器交互与样式修复

## 前置

- [ ] dev server 运行中（`npm run dev`，5173）
- [ ] 基线：`npm run smoke:editor` 32/32 通过（已确认）

## 实施顺序（每步完成后跑验证脚本确认再继续）

### Step 1: R1 引用 Backspace 兜底
- `AtomicEditor.tsx`：新增 `exitBlockquoteOnBackspace`，并入现有 `Prec.high(keymap.of([{key:'Enter'…},{key:'Backspace'…}]))`
- 验证：临时脚本——短文档 + 600 行长文档中 `> 内容` Enter → Backspace 一次 → 行回归正常；嵌套 `> > ` 不误伤；普通行 Backspace 不回归

### Step 2: R2 高亮黄色
- `atomicTheme.css`：新增 `--atomic-editor-highlight` token（light/dark）+ `.cm-atomic-highlight` 背景覆盖
- 验证：computed background 含黄色分量（light/dark）

### Step 3: R3 下划线标签 reveal
- `underlineDecoration.ts`：selection 触及区间时标签不隐藏
- 验证：光标移入 → 行内可见 `<u>`/`</u>`；移出 → 隐藏；只读态恒隐藏

### Step 4: R4 标题字号间距
- `atomicTheme.css`：标题字号 + line-height + padding 整套覆盖
- 验证：computed font-size ≥ 1.7em（h1）、分割线与下一行间距 ≥ 0.25em、大纲跳转/滚动不回归（smoke 第 12 项）

### Step 5: R5 公式块（点击修复 + 间距实验）
- 5a 点击修复：`mathExtension.ts` MathWidget 加 from/to + posAtCoords 校验
- 5b 间距：实验方案 A（移除 minHeight）→ 验证点击/Enter/滚动/切换无回归；失败回退方案 B（minHeight + flex 居中）
- 5c 样式：`.cm-math-block` padding 统一 + katex-display margin 归零
- 验证：AC5a/AC5b 专项脚本 + smoke 公式项

### Step 6: R6 工具栏联动
- `AtomicEditor.tsx`：`onActiveFormat` prop + 状态计算（updateListener）
- `MarkdownToolbar.tsx`：`activeFormat` prop + 按钮高亮（text-destructive）
- `NoteView.tsx`：fmt state 传递
- 验证：点击标题/加粗/引用/列表 → 对应按钮红色；点击正文 → 熄灭

### Step 7: 全量回归
- `npm run smoke:editor` 32/32
- `npm run typecheck`
- 手工浏览器验证清单（PRD Notes）

### Step 8: 收尾
- 删除临时验证脚本（verify-*.tmp.mjs）
- 更新 `.trellis/spec/`（如需，遵循 trellis-update-spec）
- 提交（仅用户确认后）

## 验证命令

```bash
npm run dev                      # 前置（已运行）
node verify-<x>.tmp.mjs          # 各步专项验证（临时，放项目根，跑完删）
npm run smoke:editor             # 全量回归
npm run typecheck                # 类型检查
```

## 风险与回滚

| 风险 | 处置 |
|---|---|
| R5 方案 A（移除 minHeight）导致点击/滚动错位 | 立即回退方案 B（保留 minHeight + flex 居中 + posAtCoords 校验），D5 已预留 |
| R6 状态计算性能（长文档 selection 频繁触发） | 语法树仅 resolveInner 局部解析 + 正则限当前行；若仍卡顿加节流 |
| R4 行高增大导致 CM6 块行测量偏差 | 与 atomic 默认量级一致（line-height 1.28-1.42、padding 0.2-0.3em），smoke 第 12 项（大纲跳转）验证 |
| R1 handler 误伤（如文档中 `> ` 开头非引用文本行） | Markdown 中 `> ` 行首本身即引用语义，按行文本处理与 Enter handler 一致（现状已如此） |
