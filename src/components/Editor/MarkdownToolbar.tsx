/**
 * components/Editor/MarkdownToolbar.tsx —— 笔记编辑态快捷操作栏（用户确认的 19 项）
 *
 * 语义：按钮在光标处插入 markdown 语法（源文本标准 markdown）：
 * - wrap 类：选中文本包裹（加粗/斜体/…），无选中插占位光标居中
 * - 行级：标题/列表/引用/勾选框插入行首（标题自动替换级别）
 * - 块级：代码块/公式块/表格/分割线在光标处插入多行块
 * 放在笔记详情工具行下方一行（不额外占常驻空间，仅编辑态显示）。
 */
import { memo } from 'react'
import {
  Bold,
  Calculator,
  Code,
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  Sigma,
  SquareCheck,
  Strikethrough,
  Table,
  Underline,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { MarkdownInsertApi } from './CodeMirrorEditor'

interface ToolDef {
  id: string
  label: string
  icon: typeof Bold
  run(api: MarkdownInsertApi): void
}

/** 行首标记类工具（标题/列表/引用/勾选） */
const lineTools = (prefix: string): ToolDef['run'] => (api) => api.block(prefix)

const TOOLS: ToolDef[] = [
  // ---- 行内 wrap ----
  { id: 'bold', label: '加粗', icon: Bold, run: (a) => a.wrap('**', '**', '加粗文本') },
  { id: 'italic', label: '斜体', icon: Italic, run: (a) => a.wrap('*', '*', '斜体文本') },
  { id: 'underline', label: '下划线', icon: Underline, run: (a) => a.wrap('<u>', '</u>', '下划线文本') },
  { id: 'strike', label: '删除线', icon: Strikethrough, run: (a) => a.wrap('~~', '~~', '删除线文本') },
  { id: 'highlight', label: '高亮', icon: Highlighter, run: (a) => a.wrap('==', '==', '高亮文本') },
  { id: 'inline-code', label: '内联代码', icon: Code, run: (a) => a.wrap('`', '`', 'code') },
  { id: 'inline-math', label: '内联公式', icon: Sigma, run: (a) => a.wrap('$', '$', '公式') },
  { id: 'link', label: '链接', icon: Link, run: (a) => a.wrap('[', '](url)', '链接文字') },
  { id: 'image', label: '图片', icon: Image, run: (a) => a.wrap('![', '](url)', '图片描述') },
  // ---- 行级 ----
  { id: 'h1', label: '一级标题', icon: Heading1, run: lineTools('# ') },
  { id: 'h2', label: '二级标题', icon: Heading2, run: lineTools('## ') },
  { id: 'h3', label: '三级标题', icon: Heading3, run: lineTools('### ') },
  { id: 'ul', label: '无序列表', icon: List, run: lineTools('- ') },
  { id: 'ol', label: '有序列表', icon: ListOrdered, run: lineTools('1. ') },
  { id: 'task', label: '勾选框', icon: SquareCheck, run: lineTools('- [ ] ') },
  { id: 'quote', label: '引用', icon: Quote, run: lineTools('> ') },
  // ---- 块级 ----
  { id: 'codeblock', label: '代码块', icon: CodeXml, run: (a) => a.block('```', '```', { block: true }) },
  { id: 'mathblock', label: '公式块', icon: Calculator, run: (a) => a.block('$$', '$$', { block: true }) },
  {
    id: 'table',
    label: '表格',
    icon: Table,
    run: (a) =>
      a.block(
        '| 列1 | 列2 |\n| --- | --- |\n| 内容 | 内容 |',
        '',
        { block: true, placeholder: '' },
      ),
  },
  { id: 'hr', label: '分割线', icon: Minus, run: (a) => a.block('\n---\n', '', { block: true }) },
]

export default memo(function MarkdownToolbar({ api }: { api: MarkdownInsertApi }) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-0.5 px-1.5 py-1"
      role="toolbar"
      aria-label="Markdown 快捷插入"
    >
      {TOOLS.map((t) => (
        <Tooltip key={t.id}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6.5 text-muted-foreground hover:text-foreground"
              aria-label={t.label}
              onClick={() => t.run(api)}
            >
              <t.icon data-icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
})
