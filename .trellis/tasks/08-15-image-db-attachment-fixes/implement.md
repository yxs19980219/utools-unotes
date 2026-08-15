# Implement —— 图片存 db 附件 + 待办变灰 + 列表缩进

## 执行顺序（由易到难，独立可验证）

1. **P3 列表缩进对齐**（一行 CSS）
   - [ ] atomicTheme.css：`.cm-atomic-list-marker { min-width: 0.9em; }`
   - [ ] 验证：Playwright 测量各级 marker 布局宽与文字起点差 ≈ 22.2px 统一（±1px）

2. **P2 待办完成态变灰**（CSS 覆盖）
   - [ ] atomicTheme.css：`:checked` 灰背景/边框 + `.cm-atomic-task-done` 去行背景
   - [ ] 验证：computed style（checkbox bg=灰、行无 background）

3. **P1 图片附件**（写入 + 渲染 patch）
   - [ ] AtomicEditor.tsx paste handler：uTools 环境 → arrayBuffer → postAttachment → `utools-db://` 引用；失败 toast；浏览器降级 data URL
   - [ ] node_modules image-blocks.js：ImageWidget.toDOM 加 utools-db:// 分支（异步 getAttachment → Blob → objectURL；非 uTools 占位）
   - [ ] 更新 patches/@atomic-editor+editor+0.6.2.patch（hunk 升序、LF、末尾换行）→ `git apply --reverse --check` 验证
   - [ ] 验证（mock utools）：
     - 注入 window.utools mock（postAttachment 记录调用、getAttachment 返回 PNG bytes）
     - 粘贴图片 → 断言 mock 收到 `img/<uuid>` 附件 + markdown 为短引用
     - 渲染 → 断言 img.src 为 blob: URL
     - postAttachment 返回 { ok: false } → toast 出现、不插入
   - [ ] 浏览器降级路径回归：无 utools 时粘贴仍插入 data URL

## 全量验证

- [ ] `npm run typecheck` && `npm run build`
- [ ] `npm run smoke` / `smoke:stores` / `smoke:outline` / `smoke:tableOps` / `smoke:tableModel`
- [ ] `npm run smoke:editor`（dev server 5173）
- [ ] `npm run ui-smoke`

## 评审关卡

- [ ] 每分项独立 commit（3-4 个），可单独 revert
- [ ] patch 文件更新通过 `git apply --reverse --check`
- [ ] 无遗留探测脚本

## 风险预案

- R1 getAttachment 返回类型差异 → Blob 构造兼容多类型
- R2 mock utools 渲染验证 → 注入假实现走 dev
- R3 patch 维护坑 → 按 spec 硬规则执行
