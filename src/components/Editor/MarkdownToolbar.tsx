/**
 * components/Editor/MarkdownToolbar.tsx —— 笔记编辑态快捷操作栏（用户确认的 19 项）
 *
 * 语义：按钮通过 MarkdownInsertApi 写入标准 Markdown，并依赖编辑器装饰即时呈现效果：
 * - wrap 类：选中文本包裹（加粗/斜体/…），无选中插占位光标居中
 * - 行级：标题/列表/引用/勾选框插入行首（标题自动替换级别）
 * - 块级：代码块/公式块/表格/分割线插入后直接进入视觉渲染；表格由真实 Block Widget 承载
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
import { cn } from '@/lib/utils'
import type { ActiveFormatState, MarkdownInsertApi } from './AtomicEditor'

interface ToolDef {
  id: string
  label: string
  icon: typeof Bold
  run(api: MarkdownInsertApi): void
  /** 工具栏联动：光标处于该格式时按钮高亮 */
  match?(fmt: ActiveFormatState): boolean
}

/** 行首标记类工具（标题/列表/引用/勾选） */
const lineTools = (prefix: string): ToolDef['run'] => (api) => api.block(prefix)

/**
 * 图片选择：uTools 环境走 showOpenDialog；浏览器环境（dev/headless）降级 input[type=file]
 * （f.path 为 Electron 扩展，普通浏览器用 blob URL 保证图片可显示）
 */
function pickImageFile(cb: (path: string) => void): void {
  const utoolsApi = (globalThis as { utools?: { showOpenDialog?: (o: object) => string[] | undefined } }).utools
  if (utoolsApi?.showOpenDialog) {
    const files = utoolsApi.showOpenDialog({
      title: '选择图片',
      filters: [
        {
          name: '图片',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
        },
      ],
      properties: ['openFile'],
    })
    if (files && files.length > 0) cb(files[0])
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const f = input.files?.[0]
    if (!f) return
    const path = (f as { path?: string }).path
    if (path) {
      cb(path)
      return
    }
    // 浏览器降级：无 Electron 文件路径，转 data URL 插入（避免 blob URL 无法释放的内存驻留）
    const reader = new FileReader()
    reader.onload = () => cb(String(reader.result))
    reader.readAsDataURL(f)
  }
  input.click()
}

const TOOLS: ToolDef[] = [
  // ---- 行内 wrap ----
  { id: 'bold', label: '加粗', icon: Bold, run: (a) => a.toggleInline('**', '**', 'StrongEmphasis'), match: (f) => f.bold },
  { id: 'italic', label: '斜体', icon: Italic, run: (a) => a.toggleInline('*', '*', 'Emphasis'), match: (f) => f.italic },
  { id: 'underline', label: '下划线', icon: Underline, run: (a) => a.toggleInline('<u>', '</u>'), match: (f) => f.underline },
  { id: 'strike', label: '删除线', icon: Strikethrough, run: (a) => a.wrap('~~', '~~'), match: (f) => f.strike },
  { id: 'highlight', label: '高亮', icon: Highlighter, run: (a) => a.wrap('==', '=='), match: (f) => f.highlight },
  { id: 'inline-code', label: '内联代码', icon: Code, run: (a) => a.wrap('`', '`'), match: (f) => f.inlineCode },
  { id: 'inline-math', label: '内联公式', icon: Sigma, run: (a) => a.wrap('$', '$') },
  { id: 'link', label: '链接', icon: Link, run: (a) => a.wrap('[', '](url)'), match: (f) => f.link },
  { id: 'image', label: '图片', icon: Image, run: (a) => pickImageFile((p) => a.insertImage(p)) },
  // ---- 行级 ----
  { id: 'h1', label: '一级标题', icon: Heading1, run: lineTools('# '), match: (f) => f.heading === 1 },
  { id: 'h2', label: '二级标题', icon: Heading2, run: lineTools('## '), match: (f) => f.heading === 2 },
  { id: 'h3', label: '三级标题', icon: Heading3, run: lineTools('### '), match: (f) => f.heading === 3 },
  { id: 'ul', label: '无序列表', icon: List, run: lineTools('- '), match: (f) => f.ul },
  { id: 'ol', label: '有序列表', icon: ListOrdered, run: lineTools('1. '), match: (f) => f.ol },
  { id: 'task', label: '勾选框', icon: SquareCheck, run: lineTools('- [ ] '), match: (f) => f.task },
  { id: 'quote', label: '引用', icon: Quote, run: lineTools('> '), match: (f) => f.quote },
  // ---- 块级 ----
  { id: 'codeblock', label: '代码块', icon: CodeXml, run: (a) => a.block('```ts', '```', { block: true }) },
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

export default memo(function MarkdownToolbar({
  api,
  activeFormat,
}: {
  api: MarkdownInsertApi
  activeFormat?: ActiveFormatState
}) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-0.5 px-1.5 py-1"
      role="toolbar"
      aria-label="Markdown 快捷插入"
    >
      {TOOLS.map((t) => {
        const active = !!activeFormat && t.match?.(activeFormat)
        return (
          <Tooltip key={t.id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  'size-6.5 text-muted-foreground hover:text-foreground',
                  active &&
                    'bg-accent text-destructive hover:bg-accent hover:text-destructive',
                )}
                data-active={active || undefined}
                aria-pressed={active}
                aria-label={t.label}
                onClick={() => t.run(api)}
              >
                <t.icon data-icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
})
