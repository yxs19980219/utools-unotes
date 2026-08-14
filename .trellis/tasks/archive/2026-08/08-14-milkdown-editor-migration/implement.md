# Implement：Milkdown 编辑器核心迁移

## 前置

- 任务：`.trellis/tasks/08-14-milkdown-editor-migration`（prd.md / design.md 已齐）
- 验证命令：
  - `npm run typecheck`（tsc -b）
  - `npm run build`
  - `npm run smoke` / `smoke:editor`（`scripts/smoke-editor.mjs`，先确认其断言内容）
  - `npm run ui-smoke`（playwright，编辑器相关用例）
- 环境：uTools 插件（Chromium 108 兼容：CSS rgba 先行、color-mix 覆盖）

## 实施清单（有序）

### 1. 依赖与可行性验证（最小 demo）
- [ ] 安装 `@milkdown/kit @milkdown/react @milkdown/crepe`（版本对齐 7.22.1）
- [ ] 临时最小组件验证：`Editor.make().use(commonmark).use(gfm).use(latexFeature).use(placeholderFeature)` 能否独立 work（latex/placeholder 来自 `@milkdown/crepe/feature/*`）
- [ ] 记录验证结论：可行 → 正式方案；依赖 crepe slice → 改 CrepeBuilder 方案 / 自研精简 latex
- [ ] 验证 `@milkdown/kit/prose/keymap` Mod-s、`editorViewOptionsCtx` editable、listener.markdownUpdated

### 2. 编辑器壳 MilkdownEditor.tsx（新建）
- [ ] React 壳：MilkdownProvider + useEditor 装配（commonmark/gfm/latex/placeholder/highlight/underline/codeBlock/listener/keymap/editable）
- [ ] props 契约与现 AtomicEditor 完全一致（value/onChange/onSave/placeholder/autoFocus/className/documentId/readOnly + forwardRef）
- [ ] 受控：key={documentId} remount + markdownUpdated 回写 + value 兜底 replaceAll
- [ ] placeholder 文案与现版一致：`记录要点：# 标题、**加粗**、- 列表、``` 代码块 …`
- [ ] 只读：editable: () => !readOnly

### 3. markdownInsertApi.ts（新建，替代 codeMirrorApi.ts）
- [ ] MarkdownInsertApi 接口签名不变（wrap/block/insertImage/jumpTo/focus）
- [ ] wrap：按 before 分派 toggleMark（strong/em/strike/inline_code/highlight/underline）/ toggleLink / math_inline 插入
- [ ] block：按 prefix 分派 setBlockType(heading) / wrapInList(ul/ol/taskList) / wrapInBlockquote / setBlockType(code_block + language) / math_block / table / horizontal_rule
- [ ] insertImage：image 节点插入（alt=文件名无扩展、src=path）
- [ ] jumpTo：按 OutlineItem（level+text）遍历 heading 节点定位 + scrollIntoView（契约随 NoteView 改造）
- [ ] focus

### 4. 自研 mark 插件
- [ ] `plugins/highlightMark.ts`：schema + 解析（`==x==`）+ 序列化（`==x==`）+ toggleMark 命令
- [ ] `plugins/underlineMark.ts`：schema + 解析（`<u>x</u>`）+ 序列化 + toggleMark 命令
- [ ] roundtrip 冒烟：`==高亮==` / `<u>下划线</u>` 编辑→序列化→再解析 不丢

### 5. 主题（milkdownTheme.css）
- [ ] 引入 common/style.css + classic.css + classic-dark.css（.dark 切换）
- [ ] 变量覆盖：--crepe-color-* → 项目 token，深浅色 + Chromium 108 兼容（rgba 先行）
- [ ] 对照现版观感逐项校准（代码块高亮灰阶、链接、选区、光标色）

### 6. 大纲跳转改造
- [ ] MetaInfoPanel.onJump(item: OutlineItem)；NoteView.handleJump 透传；api.jumpTo(item)
- [ ] 只读实例同样可用（共用内核）

### 7. 集成与清理
- [ ] NoteView import AtomicEditor → MilkdownEditor（1 行）；MarkdownToolbar import type 路径同步
- [ ] 删除 codeMirrorApi.ts / extensions/mathExtension.ts / atomicTheme.css
- [ ] package.json 移除 @atomic-editor/editor；npm install 收敛 lock

### 8. 验证（AC 全量）
- [ ] `npm run typecheck && npm run build`
- [ ] smoke 脚本检查：smoke-editor 断言是否需要随内核更新（其依赖 CM6 API 则同步改）
- [ ] 手动/playwright 验证 AC2-AC10、AC12（编辑即时渲染、19 按钮、公式、代码块、表格无拖拽、任务列表勾选、大纲跳转、只读不可变、深浅色、roundtrip）
- [ ] uTools 内实机验证（图片选择 f.path、Ctrl+S、切笔记不串档）

## 风险文件 / 回滚点

- 高风险文件：`MilkdownEditor.tsx`（装配）、`markdownInsertApi.ts`（命令映射）、latex feature 借用（crepe 内部依赖）
- 提交粒度：
  1. 依赖 + demo 验证结论（可回退：remove 依赖）
  2. 新内核壳 + API + 插件 + 主题 + 跳转改造（单提交，含旧文件删除——回滚即 revert 本提交）
  3. 后续按修复拆分

## 完成前检查

- [ ] prd AC1-AC12 全部可勾选
- [ ] typecheck/build/smoke 绿
- [ ] 无 @atomic-editor/editor 残留引用（grep 全仓）
- [ ] 新插件文件有头注释（项目风格）
