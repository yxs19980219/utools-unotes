# 图片存 db 附件 + 待办完成态框文变灰 + 列表缩进对齐

## Goal

三项修复：图片粘贴从「data URL 内嵌」改为「utools.db 附件 + 短引用」；待办完成态改为框体+文字变灰（非整行）；列表层级缩进实测对齐。

## Requirements

### P1 图片粘贴存 utools.db 附件
- uTools 环境 Ctrl+V 粘贴图片：写入 `utools.db.promises.postAttachment('img/<uuid>', buffer, mime)`，markdown 源码插入短引用 `![图片](utools-db://img/<uuid>)`（替代超长 data URL）。
- 编辑器渲染：src 以 `utools-db://` 开头时，异步 `utools.db.promises.getAttachment(id)` → Uint8Array → Blob → objectURL → 图片显示（patch @atomic-editor image-blocks）。
- 附件 10M 上限：postAttachment 失败（超限等）→ toast 报错，不插入。
- 浏览器环境（dev/headless，无 utools.db 附件能力）：降级保持现有 data URL 行为（可显示、可测试）。
- 非 uTools 环境打开含 `utools-db://` 引用的笔记：图片区域不崩、不抛错（渲染占位）。
- 已有图片语法（路径/data URL）渲染不受影响；工具栏选图（文件路径）保持现状。

### P2 待办完成态：框体 + 文字变灰
- 勾选框框体（checked 状态）背景与边框变灰（--muted-foreground 级），非黑。
- 完成行文字变灰 + 删除线（现状保留）。
- 去掉上一轮加的整行灰底背景（用户澄清：不要行背景）。

### P3 列表层级缩进对齐
- 实测根因：`.cm-atomic-list-marker` 的 `width: 0.9em` 被 inline-block min-content 规则撑开失效，
  各级 marker 实际宽度 = 字符自身宽度（二级 ○ 缩小后更窄）→ 文字起点缩进每级不一致。
- 修复：marker 元素强制固定宽度（min-width），使一级→二级、二级→三级文字缩进完全一致。
- 缩进量取实测值：保持 LIST_LEVEL_EM 现状（每级约 1.05em 视觉），只对齐文字起点。

## Acceptance Criteria

- [ ] P1：uTools 环境粘贴图片 → db 生成 `img/<uuid>` 附件文档，markdown 为 `![图片](utools-db://img/<uuid>)` 短引用（无 base64 长串）
- [ ] P1：渲染时 `utools-db://` 引用经 getAttachment → blob URL 显示图片（mock utools 验证）
- [ ] P1：附件超 10M 或写入失败 → toast 报错、不插入；浏览器降级路径仍可用（data URL）
- [ ] P2：`- [x]` 完成项：checkbox 灰框 + 文字灰 + 删除线；无整行背景；`- [ ]` 未完成项不变
- [ ] P3：一二三级的文字起点缩进差一致（±1px），marker 视觉宽度统一
- [ ] 回归：typecheck / build / smoke / smoke:editor / ui-smoke 全通过

## Notes

- 约束：uTools 渲染进程可直接调用 utools.db（无需 preload 扩展）；附件 doc 与笔记 doc 独立，删除笔记暂不清理附件（孤儿可接受，记录）。
- 兼容：老笔记中的 data URL / 文件路径图片不受影响；导出 markdown 时 utools-db:// 引用为本插件私有语法（记录到 spec）。
- P3 已在 dev 实测：一级→二级文字起点差 14.3px、二级→三级 26.5px（应为 22.2px 统一）。
