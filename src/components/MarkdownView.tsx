/**
 * components/MarkdownView.tsx —— 只读 Markdown 轻量渲染（阶段 4 MVP）
 *
 * 范围（implement.md 4c）：标题 #~#### / 粗体 / 斜体 / 行内代码 / 链接 /
 * 代码块（```） / 列表（ul/ol/任务） / 引用 / 分隔线 / 段落。
 * 实现：逐行块解析 + 行内 token 化，渲染 React 元素（React 自动转义，无 XSS 面）。
 * 注意：阶段 5 CodeMirror 预览渲染可复用本组件；嵌套列表 / 复杂语法不在 MVP。
 */
import { useMemo, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string }

const INLINE_RE =
  /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]\n]+\]\([^)\n]+\))/g

/** 行内解析：`**粗**` `*斜*` `` `码` `` `[文](url)`，其余为纯文本 */
function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) })
    if (m[1]) tokens.push({ type: 'bold', value: m[1].slice(2, -2) })
    else if (m[2]) tokens.push({ type: 'italic', value: m[2].slice(1, -1) })
    else if (m[3]) tokens.push({ type: 'code', value: m[3].slice(1, -1) })
    else if (m[4]) {
      const inner = m[4].slice(1, -1) // [text](url) 去掉外层
      const sep = inner.lastIndexOf('](')
      tokens.push({
        type: 'link',
        value: inner.slice(0, sep),
        href: inner.slice(sep + 2),
      })
    }
    last = INLINE_RE.lastIndex
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) })
  return tokens
}

function renderInline(tokens: InlineToken[], keyPrefix: string): ReactNode {
  return tokens.map((t, i) => {
    const key = `${keyPrefix}-${i}`
    switch (t.type) {
      case 'bold':
        return <strong key={key}>{t.value}</strong>
      case 'italic':
        return <em key={key}>{t.value}</em>
      case 'code':
        return (
          <code
            key={key}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          >
            {t.value}
          </code>
        )
      case 'link':
        return (
          <a
            key={key}
            href={t.href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            {t.value}
          </a>
        )
      default:
        return <span key={key}>{t.value}</span>
    }
  })
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'hr' }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: { text: string; checked: boolean | null }[] }
  | { kind: 'para'; lines: string[] }

const HEADING_RE = /^(#{1,4})\s+(.*)$/
const HR_RE = /^\s*(?:---|\*\*\*)\s*$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/

/** 块级解析：代码块优先，其次标题/分隔线/引用/列表，其余归段落 */
function parseBlocks(content: string): Block[] {
  const lines = content.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0

  const flushPara = (buf: string[]) => {
    if (buf.length > 0) {
      blocks.push({ kind: 'para', lines: [...buf] })
      buf.length = 0
    }
  }

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 代码块
    if (trimmed.startsWith('```')) {
      flushPara([])
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      i += 1 // 跳过结束围栏
      blocks.push({ kind: 'code', text: buf.join('\n') })
      continue
    }
    // 标题
    const h = HEADING_RE.exec(line)
    if (h) {
      flushPara([])
      blocks.push({ kind: 'heading', level: h[1].length, text: h[2] })
      i += 1
      continue
    }
    // 分隔线
    if (HR_RE.test(line)) {
      flushPara([])
      blocks.push({ kind: 'hr' })
      i += 1
      continue
    }
    // 引用（连续行合并）
    if (QUOTE_RE.test(line)) {
      flushPara([])
      const buf: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        buf.push(QUOTE_RE.exec(lines[i])![1])
        i += 1
      }
      blocks.push({ kind: 'quote', lines: buf })
      continue
    }
    // 列表（连续项合并；任务项识别 - [x] 前缀）
    if (TASK_RE.test(line) || LIST_RE.test(line)) {
      flushPara([])
      const ordered = /^\s*\d+[.)]/.test(line)
      const items: { text: string; checked: boolean | null }[] = []
      while (i < lines.length) {
        const task = TASK_RE.exec(lines[i])
        if (task) {
          items.push({ text: task[2], checked: task[1].toLowerCase() === 'x' })
          i += 1
          continue
        }
        const item = LIST_RE.exec(lines[i])
        if (!item) break
        items.push({ text: item[1], checked: null })
        i += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    // 空行：段落在此断开
    if (!trimmed) {
      flushPara([])
      i += 1
      continue
    }
    // 普通段落行
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !TASK_RE.test(lines[i]) &&
      !LIST_RE.test(lines[i]) &&
      !lines[i].trim().startsWith('```')
    ) {
      buf.push(lines[i])
      i += 1
    }
    flushPara(buf)
  }
  flushPara([])
  return blocks
}

const HEADING_CLASS = [
  'text-[1.4rem] font-bold leading-snug', // h1（与编辑器装饰对齐）
  'text-[1.2rem] font-semibold leading-snug', // h2
  'text-[1.05rem] font-semibold', // h3
  'text-[0.95rem] font-semibold text-muted-foreground', // h4
]

export default function MarkdownView({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const blocks = useMemo(() => parseBlocks(content), [content])

  return (
    <div className={cn('flex flex-col gap-1.5 text-sm leading-relaxed', className)}>
      {blocks.map((b, i) => {
        const key = `b${i}`
        switch (b.kind) {
          case 'heading':
            return (
              <div
                key={key}
                className={cn(HEADING_CLASS[b.level - 1] ?? HEADING_CLASS[3], 'pt-1')}
              >
                {renderInline(parseInline(b.text), key)}
              </div>
            )
          case 'code':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed"
              >
                {b.text}
              </pre>
            )
          case 'hr':
            return <div key={key} className="my-1 border-t border-border" />
          case 'quote':
            return (
              <div key={key} className="flex flex-col gap-0.5 border-l-2 border-border pl-2 text-muted-foreground">
                {b.lines.map((l, j) => (
                  <div key={j}>{renderInline(parseInline(l), `${key}-${j}`)}</div>
                ))}
              </div>
            )
          case 'list': {
            const Comp = b.ordered ? 'ol' : 'ul'
            return (
              <Comp key={key} className={cn('flex flex-col gap-0.5', b.ordered && 'list-decimal pl-5', !b.ordered && 'list-disc pl-5')}>
                {b.items.map((item, j) => (
                  <li key={j} className={cn(item.checked !== null && 'list-none -indent-1 pl-1')}>
                    {item.checked !== null && (
                      <span className="mr-1 select-none text-muted-foreground">
                        {item.checked ? '☑' : '☐'}
                      </span>
                    )}
                    {renderInline(parseInline(item.text), `${key}-${j}`)}
                  </li>
                ))}
              </Comp>
            )
          }
          default:
            return (
              <p key={key}>
                {b.lines.map((l, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {renderInline(parseInline(l), `${key}-${j}`)}
                  </span>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}
