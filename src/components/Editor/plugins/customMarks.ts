/**
 * components/Editor/plugins/customMarks.ts —— 自研扩展 mark：==高亮== 与 <u>下划线</u>
 *
 * 背景（任务 08-14-milkdown-editor-migration，D2）：这两个语法不是标准 markdown，
 * milkdown 无内置。旧内核（atomic/CM6）自研装饰渲染，本插件在 Milkdown
 * （remark 解析 + ProseMirror 文档模型）中提供等价能力：
 *
 * - 解析：$remark 转换插件把 text 中的 `==x==` 拆成 highlight 节点、把内联
 *   html `<u>x</u>` 拆成 underline 节点（unist-util-visit 遍历 AST）
 * - 序列化：remark-stringify 自定义 handlers 输出 `==x==` / `<u>x</u>`（roundtrip 保真）
 * - 编辑：toggleMark 命令 + 输入规则 `==` / `<u>` 自动激活
 * - 渲染：mark schema（<mark> / <u> 标签），视觉样式走 milkdownTheme.css
 *
 * 约束：`==` 拆分为 text 节点层面进行，代码/公式/链接是独立节点类型，天然不冲突；
 * mark 嵌套（加粗的高亮）由 ProseMirror mark 栈自动处理。
 */
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { markRule } from '@milkdown/kit/prose'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import {
  $command,
  $inputRule,
  $markSchema,
  $remark,
} from '@milkdown/kit/utils'
import type { Handle } from 'mdast-util-to-markdown'
import { visit } from 'unist-util-visit'

/* ------------------------------------------------------------------ */
/* remark 转换：==x== → highlight 节点；<u>x</u> → underline 节点        */
/* ------------------------------------------------------------------ */

/** 行内 `==x==`（内容不含 =，对齐旧 mathExtension 的行内边界惯例） */
const HIGHLIGHT_RE = /(==[^=]+==)/g

/** remark-parse 把 `<u>…</u>` 拆为开/闭两个 html 节点（value 分别为 `<u>`、`</u>`） */
const UNDERLINE_OPEN_RE = /^\s*<u>\s*$/i
const UNDERLINE_CLOSE_RE = /^\s*<\/u>\s*$/i

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  [k: string]: unknown
}

/** 把 text 节点中的 `==x==` 拆分为 highlight 节点（原样保留非命中文本） */
function splitHighlightSegments(node: MdastNode): MdastNode[] | null {
  if (typeof node.value !== 'string' || !node.value.includes('==')) return null
  const parts = node.value.split(HIGHLIGHT_RE)
  if (parts.length === 1) return null
  // split 会产出空串片段（如 '==x=='.split → ['', '==x==', '']）；
  // 空 text 节点会导致 ProseMirror 解析报错（Empty text nodes），必须过滤
  return parts
    .filter((p) => p.length > 0)
    .map((p) => {
      if (p.startsWith('==') && p.endsWith('==')) {
        return {
          type: 'highlight',
          children: [{ type: 'text', value: p.slice(2, -2) }],
        }
      }
      return { type: 'text', value: p }
    })
}

/** 成对的 `<u>` / `</u>` html 节点 → underline 节点（合并中间子节点） */
function mergeUnderlineNodes(
  parent: MdastNode,
  openIndex: number,
  closeIndex: number,
): MdastNode {
  const content = (parent.children ?? []).slice(openIndex + 1, closeIndex)
  return { type: 'underline', children: content as MdastNode[] }
}

/** 解析期转换：text `==x==` → highlight；`<u>x</u>` → underline */
export const customMarksRemarkPlugin = $remark('customMarksRemark', () => () => (tree) => {
  // text 节点：拆 ==x== → highlight 节点
  visit(tree, 'text', (node, index, parent) => {
    if (!parent || index === undefined || index === null) return
    const replaced = splitHighlightSegments(node as unknown as MdastNode)
    if (replaced) parent.children.splice(index, 1, ...(replaced as never[]))
  })
  // html 节点：成对 `<u>` / `</u>` → underline 节点
  visit(tree, 'html', (node, index, parent) => {
    if (!parent || index === undefined || index === null) return
    const isOpen = UNDERLINE_OPEN_RE.test(node.value ?? '')
    if (!isOpen) return
    const children = parent.children
    const closeIdx = children.findIndex(
      (c, i) => i > index && c.type === 'html' && UNDERLINE_CLOSE_RE.test(c.value ?? ''),
    )
    if (closeIdx === -1) return
    const underlineNode = mergeUnderlineNodes(parent as unknown as MdastNode, index, closeIdx)
    children.splice(index, closeIdx - index + 1, underlineNode as never)
  })
})

/* ------------------------------------------------------------------ */
/* schema                                                              */
/* ------------------------------------------------------------------ */

/** ==高亮== mark：schema + 解析（highlight 节点）+ 序列化 */
export const highlightSchema = $markSchema('highlight', () => ({
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', { class: 'milkdown-highlight' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'highlight')
    },
  },
}))

/** <u>下划线</u> mark：schema + 解析（underline 节点）+ 序列化 */
export const underlineSchema = $markSchema('underline', () => ({
  parseDOM: [{ tag: 'u' }],
  toDOM: () => ['u', { class: 'milkdown-underline' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'underline',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, mark) => {
      state.withMark(mark, 'underline')
    },
  },
}))

/* ------------------------------------------------------------------ */
/* 序列化 handlers（mdast 自定义节点 → markdown 文本）                   */
/* ------------------------------------------------------------------ */

export const customMarksStringify = (ctx: Ctx) => {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    handlers: {
      ...(prev.handlers ?? {}),
      highlight: ((node, _parent, state, info) =>
        `==${state.containerPhrasing(node, info)}==`) as Handle,
      underline: ((node, _parent, state, info) =>
        `<u>${state.containerPhrasing(node, info)}</u>`) as Handle,
    },
  }))
}

/* ------------------------------------------------------------------ */
/* 输入规则与命令                                                       */
/* ------------------------------------------------------------------ */

/** 输入 `==x==` 时自动转为 highlight mark */
export const highlightInputRule = $inputRule((ctx) =>
  markRule(/(?:==)([^=]+)(?:==)$/, highlightSchema.type(ctx)),
)

/** 输入 `<u>x</u>` 时自动转为 underline mark */
export const underlineInputRule = $inputRule((ctx) =>
  markRule(/<u>([^<]*)<\/u>$/, underlineSchema.type(ctx)),
)

/** 切换高亮 mark（工具栏按钮复用） */
export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => () =>
  toggleMark(highlightSchema.type(ctx)),
)

/** 切换下划线 mark（工具栏按钮复用） */
export const toggleUnderlineCommand = $command('ToggleUnderline', (ctx) => () =>
  toggleMark(underlineSchema.type(ctx)),
)

/** 全部自研 mark 插件（装配入口一次性 .use） */
export const customMarks: MilkdownPlugin[] = [
  customMarksRemarkPlugin,
  highlightSchema,
  underlineSchema,
  highlightInputRule,
  underlineInputRule,
  toggleHighlightCommand,
  toggleUnderlineCommand,
].flat()

export type { InputRule, MdastNode }
