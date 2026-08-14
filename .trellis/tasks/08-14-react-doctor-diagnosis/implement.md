# 执行计划 — React 诊断修复

## 验证命令

- 类型检查：`npm run typecheck`
- 回归扫描：`npx react-doctor@latest --verbose --scope changed`
- 全量复查：`npx react-doctor@latest --verbose`

## 修复清单（按严重度排序）

### A. 破坏性删除（已获用户确认）

1. 删除 `src/components/ui/toggle.tsx`、`src/components/ui/toggle-group.tsx`（全项目无引用）。
2. 从 `package.json` 移除依赖 `next-themes`、`tw-animate-css`。
3. 跳过 `utools-api-types`（假阳性：tsconfig types 提供全局 `utools` 类型）。

### B. Error ×2（优先）

4. `no-ref-current-in-render` — `AtomicEditor.tsx:149`、`:151`。

### C. Bugs / 性能 warning

5. `no-create-object-url-without-revoke` — `MarkdownToolbar.tsx:74`。
6. `no-array-index-as-key` — `MetaInfoPanel.tsx:76`。
7. `exhaustive-deps` ×2 — `NoteView.tsx:90`、`:99`。
8. `no-loading-flag-reset-outside-finally` ×3 — `SidebarList.tsx:138/145/152`。
9. `rerender-lazy-state-init` — `TagRowActions.tsx:70`。
10. `jsx-no-constructed-context-values` — `toggle-group.tsx:48`（随文件删除消失）。
11. `async-await-in-loop` ×2 — `db.ts:203`、`tags.ts:101`。
12. `js-flatmap-filter` ×2 — `db.ts:261`、`tagNormalize.ts:39`。
13. `js-set-map-lookups` ×3 — `tagNormalize.ts:44/105`、`tags.ts:102`。
14. `rerender-lazy-ref-init` — `AtomicEditor.tsx:155`。
15. `prefer-dynamic-import` ×7 — `AtomicEditor.tsx:23/33`、`mathExtension.ts:24/31`、`underlineDecoration.ts:15/16`、`markdownInsertApi.ts:17`。
16. `unused-export` ×2 — `TagRowActions.tsx:60`、`tagNormalize.ts:75`。
17. `only-export-components` ×4 — `badge.tsx:49`、`button.tsx:67`、`tabs.tsx:90`、`toggle.tsx:47`（后者随文件删除消失）。
18. `role-button-requires-complete-keyboard-activation` — `NoteCardList.tsx:83`。

## 注意事项

- `only-export-components` 的 badge/button/tabs 是 shadcn variant 导出惯例，需读代码判断是否真需拆分或属可接受惯例。
- `prefer-dynamic-import` 涉及 CodeMirror/编辑器重型库，改用动态 import 时注意保持编辑器初始化时序。
- 每批修复后运行 typecheck 与 changed-scope 扫描。
