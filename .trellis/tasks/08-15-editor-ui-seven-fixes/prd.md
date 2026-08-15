# 编辑器与 UI 七项修复

## Goal

修复 7 个编辑器 / UI 问题：图片粘贴、代码块高亮、主题切换、待办完成态、列表符号、弹窗/输入框视觉、搜索语法。

## Requirements

### P1 图片 Ctrl+V 粘贴无效
- 在编辑器中 Ctrl/Cmd+V 粘贴图片（如截图）应能插入并显示。
- 粘贴的图片以 data URL 形式写入 Markdown 语法 `![图片](data:image/...)`（与工具栏选图浏览器降级一致，避免 blob URL 内存驻留）。
- 粘贴非图片内容（文本）时保持编辑器默认行为。

### P2 代码块语法高亮 + 语言标签可见
- 代码块按围栏语言启用语法高亮，覆盖常用语言 TOP20（JavaScript/TypeScript/Python/Go/Rust/Ruby/Java/C/C++/PHP/Swift/Shell/SQL/HTML/CSS/XML/JSON/YAML/TOML/Dockerfile/Markdown）。
- 使用 `@atomic-editor/editor/code-languages` 的 `ATOMIC_CODE_LANGUAGES`（语言列表与本项目当前 5 种合并，删除本地重复定义）。
- 亮色模式下代码语言标签（```ts 的 `ts`）颜色清晰可读（当前 fg-faint 几乎不可见）；暗色模式不回归。
- 亮色模式下代码 token 颜色可读（Palenight 默认色板为暗背景设计，亮色下需加深）。

### P3 设置页明暗主题切换（含跟随系统）
- 设置页「偏好」新增主题切换：亮色 / 暗色 / 跟随系统，三选一，持久化。
- 默认「跟随系统」（老用户无此偏好时行为不变：跟随 prefers-color-scheme）。
- 选择「亮/暗」后不再跟随系统变化；选择「跟随系统」后恢复监听。
- 启动时按持久化偏好应用主题，不闪白；smoke-editor AC10（emulateMedia 跟随系统）不回归。

### P4 待办完成态：灰底 + 文字灰底
- 勾选完成的待办行：整行浅灰底色（--muted 级），文字为灰色（muted-foreground 级），保留删除线。
- 未完成待办样式不改变。

### P5 列表层级符号微调
- 第二层级空心圆 ○ 改小，视觉大小与第一层级实心圆 ● 接近。
- 第三层级实心方块 ■ 垂直居中（当前偏上）。
- 第一层级 ● 与有序列表序号样式不变；缩进/换行包裹对齐不回归（alcove 布局盒不动）。

### P6 弹窗与输入框去边框
- 新建笔记弹窗（Dialog）去掉外圈灰色描边（ring-1 ring-foreground/10），改为柔和阴影（shadow-lg）保持层次感。
- 输入框（Input 组件，全局：新建笔记、设置页、搜索、标签输入等）去掉灰色边框与聚焦时的粗高亮环（border-input + focus-visible ring-3），改为浅灰底（bg-muted）+ 聚焦时底色加深（已确认）。
- 设置页输入框效果与之一致（同一 Input 组件）。

### P7 搜索去掉 type: 语法
- 删除 `type:x` 来源类型搜索语法（tokenize 与 searchNotes 过滤）。
- 保留 `#标签` 与裸词；裸词按标题、标签、正文顺序命中（现有评分 10×/6×/2× 保持）。
- 搜索输入框 placeholder 文案同步更新（不再提示 type:）。

## Acceptance Criteria

- [ ] P1：编辑器内 Ctrl+V 粘贴截图 → 生成 `![图片](data:...)` 语法且图片即时渲染；粘贴文本不受影响
- [ ] P2：```python / ```go / ```rust 等 10+ 种语言围栏显示语法高亮（token 着色）；亮色下语言标签 chip 清晰可读；暗色下与修复前一致
- [ ] P2：未安装的语言包依赖已加入 package.json（patch-package 补丁不破坏 postinstall）
- [ ] P3：设置页可切换 亮色/暗色/跟随系统；选择后持久化，重启后仍生效；「跟随系统」时系统切换即时跟随；AC10 冒烟通过
- [ ] P4：- [x] 完成行整行灰底 + 文字灰色 + 删除线；- [ ] 未完成行不变
- [ ] P5：二级 ○ 与一级 ● 视觉接近；三级 ■ 垂直居中
- [ ] P6：新建笔记弹窗无描边；全局输入框无边框/无粗聚焦环，浅灰底样式
- [ ] P7：`type:book 注意力` 不再过滤来源类型（按普通关键词处理）；`#深度学习` 标签搜索不变；placeholder 更新
- [ ] 全量回归：`npm run typecheck`、`npm run build`、`npm run smoke` 系列通过

## Notes

- 约束：uTools CEF 内核 Chromium 108，CSS 不用 color-mix（现有项目约定 rgba 兜底）。
- 约束：不改 @codemirror/ 与 @atomic-editor/ 的依赖版本，只用其公开 API + patch-package（项目既有模式）。
- 兼容：Prefs 老文档无 theme 字段 → 等价「跟随系统」，不迁移数据。
- smoke-data-layer.ts 中 `type:` 语法断言随 P7 更新。
