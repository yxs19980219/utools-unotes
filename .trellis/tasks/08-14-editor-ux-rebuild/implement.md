# 实施计划：Milkdown (Crepe) 编辑器迁移

## 前置

- [ ] 加载 `trellis-before-dev` skill，阅读相关 spec 指南。
- [ ] git 分支：从 `main` 创建 `feat/editor-milkdown` 开发分支。
- [ ] 确认 prd.md O2（源文本规范化）已获用户批准。

## 实施清单（按序）

### 阶段 1：依赖与最小接入（验证可行性）

1. 安装：`npm i @milkdown/crepe @milkdown/react katex`
2. 新建 `src/components/Editor/MilkdownEditor.tsx`：最小受控壳（value→defaultValue、onChange、placeholder），features 全开。
3. `NoteView.tsx` 切换编辑器组件（临时保留 CodeMirrorEditor 作对照），运行 `npm run dev` 手动验证：
   - 公式/任务/引用/代码高亮/分割线/无灰底（对应 R1-R6）
   - 保存链路（防抖 + Ctrl+S）产出仍为 Markdown
4. **验证风险点 ①**：图片本地路径（file://）在编辑器内可显示；**③**：长文档输入流畅度。

### 阶段 2：功能契约补齐

5. `milkdownApi.ts`：实现 `MarkdownInsertApi`（wrap/block/insertImage/jumpTo/focus）→ MarkdownToolbar 19 项全通（AC8）。
6. `jumpTo(mdOffset)`：remark 解析 → 标题节点 mdast position → ProseMirror 位置 → scroll + 聚焦（AC9）。
7. 主题适配：深浅色变量覆盖（R10 / AC11）。

### 阶段 3：只读态统一与拆除

8. `NoteView` 只读分支（归档）→ Crepe readonly 渲染，删除 `MarkdownView.tsx`（AC10）。
9. 删除 CM6 自研系统与依赖：`CodeMirrorEditor.tsx`、`markdownDecorations.ts`、`markdownBlockWidgets.ts`、@codemirror/*、@uiw/react-codemirror（package.json + package-lock）。
10. 清理相关样式残留（`sn-md-*` 类、smoke-decorations/decor-styles 脚本如失效则移除并同步 package.json scripts）。

### 阶段 4：验证与收尾

11. `npm run typecheck`、`npm run build`、全部 smoke、`ui-smoke`（AC12）。
12. 体积复测：dist 解压 ≤ 5 MB（AC13）。
13. 手动回归清单：新建/编辑/保存/重开笔记、归档只读、大纲跳转、工具栏全按钮、图片插入、深浅色、Ctrl+S、空笔记 placeholder。
14. `trellis-update-spec`：沉淀 WYSIWYG 迁移经验（编辑器架构、Crepe 配置、体积基线）到 spec。
15. 提交：分阶段 commit（接入 → 契约 → 拆除 → 清理），消息遵循仓库风格。

## 验证命令

```bash
npm run typecheck
npm run build
npm run smoke          # 数据层不受影响
npm run smoke:stores
npm run smoke:tableModel   # 表格模型库保留（若废弃则移除脚本）
npm run ui-smoke
```

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|------|------|------|
| `src/components/NoteView.tsx` | 编辑/只读分支切换 | git revert 阶段 3 |
| `src/components/Editor/MilkdownEditor.tsx` | 核心新组件 | 阶段 1 后即可整体回滚 |
| `src/lib/markdownTableModel.ts` | 被 widget 引用，确认去留 | 单独判断，勿误删 |
| `package.json` / lock | 依赖增删 | 分阶段 commit，独立可回退 |

## 检查门

- 阶段 2 完成：AC8/AC9 通过。
- 阶段 3 完成：AC10 通过；确认无残留 import 报错。
- 阶段 4 完成：AC12/AC13 通过后进入 3.3 spec 更新与 3.4 提交。
