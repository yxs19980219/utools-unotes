# Implement —— 编辑器与 UI 七项修复

## 执行顺序

依赖关系：②需先装依赖；⑤的 patch 更新独立于代码；其余互不依赖。按风险从低到高推进。

1. **⑦ 搜索去 type 语法**（纯删减，最简单）
   - [ ] src/services/search.ts：tokenize 删 type 分支；SearchTokens 删 sourceType；searchNotes 删 sourceType 过滤
   - [ ] src/App.tsx：subInput placeholder 更新
   - [ ] scripts/smoke-data-layer.ts：删除/更新 type 断言
   - [ ] 验证：`npm run smoke` + `npm run typecheck`

2. **② 代码块高亮 + 语言标签**
   - [ ] 安装依赖：`npm i @codemirror/lang-python @codemirror/lang-go @codemirror/lang-rust @codemirror/lang-java @codemirror/lang-cpp @codemirror/lang-php @codemirror/lang-sql @codemirror/lang-xml @codemirror/lang-json @codemirror/lang-yaml @codemirror/legacy-modes`
   - [ ] 验证 legacy-modes 子路径（mode/ruby、swift、shell、toml、dockerfile）存在
   - [ ] AtomicEditor.tsx：CODE_LANGUAGES → ATOMIC_CODE_LANGUAGES（@atomic-editor/editor/code-languages）
   - [ ] 新建 extensions/codeInfoHighlight.ts（t.meta chip 样式）；注册在 atomicMarkdownSyntax 之后
   - [ ] atomicTheme.css：--atomic-editor-hl-* 亮色加深色板 + --editor-code-info 变量（含 .dark 覆盖，rgba 兜底）
   - [ ] 验证：typecheck + build + dev 目测亮/暗两态

3. **③ 主题三态切换**
   - [ ] src/types.ts：Prefs 加 `theme?: ThemePref`；stores/settings.ts：DEFAULT_PREFS 加 theme: 'system'
   - [ ] 新建 src/lib/theme.ts（setThemePref / applyThemePref + 监听清理单例）
   - [ ] main.tsx：首帧 setThemePref('system')；App bootstrap 后按 prefs 应用
   - [ ] SettingsView PrefsBlock：主题三态 Select + savePrefs 持久化
   - [ ] 验证：`npm run smoke:editor`（AC10）+ 手动切换三态、重启持久化

4. **① 图片 Ctrl+V 粘贴**
   - [ ] AtomicEditor.tsx：view.dom paste 监听 → clipboardData image → data URL → `![图片](data:...)` 插入；destroy 移除
   - [ ] 验证：dev 环境截图粘贴（Playwright 可注入 clipboardData 或手动）

5. **④ 待办完成态灰底**
   - [ ] atomicTheme.css：覆盖 .cm-line.cm-atomic-task-done（bg-muted + muted-foreground + 删除线）
   - [ ] 验证：dev 目测未完成/完成两态

6. **⑤ 列表符号微调**
   - [ ] 更新 patches/@atomic-editor+editor+0.6.2.patch：BulletWidget 加 data-depth
   - [ ] `npx patch-package` 重放补丁验证
   - [ ] atomicTheme.css：`[data-depth="1"]` 字号缩小、`[data-depth="2"]` translateY 居中
   - [ ] 验证：dev 目测三层符号 + 包裹换行对齐

7. **⑥ 弹窗/输入框**
   - [ ] ui/dialog.tsx：DialogContent ring-1 → shadow-lg
   - [ ] ui/input.tsx：无边框 + bg-muted + 聚焦加深
   - [ ] 验证：dev 目测新建笔记弹窗、设置页、TagInput

## 全量验证（每项完成后增量，全部完成后全量）

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run smoke`（数据层，含更新后的搜索断言）
- [ ] `npm run smoke:stores`
- [ ] `npm run smoke:editor`（编辑器 AC10 主题/公式/代码块断言）
- [ ] `npm run ui-smoke`（UI 冒烟）
- [ ] `npm run smoke:outline` / `smoke:tableOps` / `smoke:tableModel`（数据回归）

## 评审关卡

- [ ] 每分项完成即自查：改动范围最小化、无遗留调试代码
- [ ] 全量验证通过后再进 Phase 3（spec 更新 + commit）
- [ ] 回滚：每分项独立 commit，可单独 revert

## 风险预案

- t.meta 覆盖过广（design R1）→ 改走 patch 给 CodeInfo 加独立 class
- legacy-modes 子路径缺失（design R2）→ 从 ATOMIC_CODE_LANGUAGES 中剔除对应语言或降级
- 粘贴在 CEF108 不触发（design R3）→ 保留现状，记录说明
