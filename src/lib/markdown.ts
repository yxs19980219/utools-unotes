/**
 * lib/markdown.ts —— Markdown 块级语法正则（单一 owner）
 *
 * 编辑器即时渲染（markdownDecorations.ts）与只读渲染（MarkdownView.tsx）
 * 共用的块级检测规则，避免两处各自定义漂移。
 */

/** 表格分隔行（R10）：`| --- | :--: |`，单元格为 -/:/空格，首尾带 |（GFM） */
export const TABLE_SEP_RE = /^\s*\|[\s:|-]+\|\s*$/

/** 表格行（表头/数据行）：行首 | 且含至少一个 | */
export const TABLE_ROW_RE = /^\s*\|.*\|/
