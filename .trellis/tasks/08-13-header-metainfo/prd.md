# ③ 头部布局与元信息面板（需求 2-7）

## Goal

优化笔记头部：标题字号加大、标签排版改进、删除「更新于」、新增 ⓘ 元信息面板（创建/更新时间、字数、大纲跳转）。

## Requirements（来自 parent PRD 需求 2-7）

2. 标题字号加大（当前 text-sm → text-lg）
3. 标签小字号（text-[0.7rem]）、紧跟标题后排列；一行放不下才折行（flex-wrap）
4. 没有标签时标题独占一行，不留空行（标题与标签同一容器，标签为空自然不占行）
5. 删除「更新于」文字（元信息改由 ⓘ 面板承载）
6. 编辑功能栏最右侧放圆形感叹号按钮（ⓘ）——位于 MarkdownToolbar 同行的最右端，与工具栏同享上下细线包裹
7. ⓘ 点击弹出元信息面板（Popover）：创建时间、更新时间、字数、可点击跳转的大纲列表

## Acceptance Criteria

- [x] 2-4: 头部单行（返回 + 标题 text-lg 18px + 标签小字号 text-[0.7rem] 紧跟，flex-wrap 折行），无标签时无空行；ui-smoke 47 项全绿
- [x] 5: 「更新于」已删除（实测 body 无该文本）
- [x] 6: ⓘ 按钮位于工具栏最右端（ml-auto），与工具栏同一细线包裹行（边框移到外层容器）
- [x] 7: 面板显示创建/更新时间（formatTime）、字数（countChars）、大纲（parseOutline 1-6 级）；点击大纲项 → jumpTo 滚动 + 光标定位（实测滚动 1804/3000 + 光标行正确）
- [x] 大纲纯函数 lib/outline.ts + scripts/smoke-outline.ts（3 项断言，npm run smoke:outline）
- [x] 只读视图无 ⓘ（面板只在 showEditor 分支）；头部布局编辑/只读共用
- [x] 回归：typecheck/build/smoke 19 项/stores 18 项/decorations 9 项/ui-smoke 47 项全绿

## Notes

- 无硬依赖 ①④；可与 ④ 并行（注意 ④ 的工具栏样式改动可能与 6 冲突，需协调——工具栏细线在 ④，ⓘ 按钮在 ③，同一行布局，执行顺序上 ③ 在 ④ 后，以 ③ 为准）
- 元信息面板：字数从 note.content 统计；大纲列表解析 content 的标题生成（可复用 MarkdownView 的标题正则或 ① 的语法树思路），点击跳转编辑器对应位置（需 CodeMirror 滚动 API）
- 布局参考：Obsidian 属性面板 / Notion 页面元信息
