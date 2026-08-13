/**
 * components/Editor/markdownDecorations.ts —— CodeMirror 6 即时渲染装饰（阶段 5a 重构，任务 08-13-perf-smoothness）
 *
 * 契约（design.md 第 3~5 节）：
 * - decorations 只改显示不改内容：源码始终是纯 markdown，对输入/撤销/拼写零副作用
 *   （仅 ViewPlugin + decorations，不拦截事务）
 * - 全部样式走语义色 CSS 变量；暗色模式随 html.dark Token 自动切换
 * - 语法覆盖：标题 #~######、粗体/斜体/行内代码、链接、列表（含任务复选框/嵌套）、
 *   引用、分隔线、代码块围栏、GFM 表格（表头加粗/边框/分隔符淡色，单元格内不 scanInline）
 * - 光标行机制：光标行显示淡色标题标记，非光标行标记隐藏（占位保留）但标题样式保留
 *
 * 性能策略（08-13-perf-smoothness design.md §5，v3 最终版）：
 * - 装饰从 lezer 语法树派生（@codemirror/lang-markdown + GFM 扩展，解析器增量更新）
 * - 每次 docChanged / 光标跨行：全量遍历语法树重建（5000 行 0.14ms，正则版 2.45ms 的 17 倍提升）；
 *   未变区域的 DOM 更新由 CM6 RangeSet.compare 增量处理（实测每键 DOM 变更 3 处）
 * - 曾尝试变化行局部重建（v2），因 RangeSetBuilder 分层（nextLayer）与 between 复制
 *   的回调顺序冲突导致 from 逆序违规，且实测无端到端收益，已回退（design.md §5 记录）
 * - 首次构建/headless 测试：buildDecorations(state) 全量遍历语法树
 */
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

/* ------------------------------------------------------------------ */
/* 编辑器主题（chrome + 装饰类样式）：全部语义色                          */
/* ------------------------------------------------------------------ */

export const markdownEditorTheme: Extension = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
    // 正文 16px：uTools 窗口在 Windows DPI 缩放下偏小，用户要求加大
    fontSize: '1rem',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-sans)',
    lineHeight: '1.55',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    padding: '0',
  },
  '.cm-line': { padding: '0 4px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--accent)' },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklab, var(--accent) 45%, transparent)',
  },
  '.cm-placeholder': { color: 'var(--muted-foreground)', opacity: '0.7' },

  /* ---- 装饰类（全部语义色，暗色随 Token 自动切换） ---- */
  /* 淡色语法标记（标题 # / 粗斜标记 / 列表符号 / 引用 > / 围栏） */
  '.sn-md-dim': { color: 'var(--muted-foreground)', opacity: '0.45' },
  /* 非光标行标题/列表标记：完全收起（display:none 不占位）→ 内容顶格展示（Obsidian 折叠标记同款） */
  '.sn-md-hidden': { display: 'none' },
  /* 标题整行样式（字号/字重随级别，与 MarkdownView 只读渲染对齐） */
  '.sn-md-h1': { fontSize: '1.6rem', fontWeight: '700', lineHeight: '1.25' },
  '.sn-md-h2': { fontSize: '1.35rem', fontWeight: '650', lineHeight: '1.3' },
  '.sn-md-h3': { fontSize: '1.15rem', fontWeight: '600', lineHeight: '1.35' },
  '.sn-md-h4': { fontSize: '1rem', fontWeight: '600', color: 'var(--muted-foreground)', lineHeight: '1.4' },
  '.sn-md-h5': { fontSize: '0.95rem', fontWeight: '600', color: 'var(--muted-foreground)', lineHeight: '1.4' },
  '.sn-md-h6': { fontSize: '0.9rem', fontWeight: '600', color: 'var(--muted-foreground)', lineHeight: '1.4' },
  '.sn-md-bold': { fontWeight: '600' },
  '.sn-md-italic': { fontStyle: 'italic' },
  '.sn-md-code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85em',
    backgroundColor: 'var(--muted)',
    borderRadius: '3px',
    padding: '0 2px',
  },
  '.sn-md-link': {
    // R13（用户拍板）：链接 = 前景色 + 下划线（浅色模式一期 --primary 浅灰不可见）
    color: 'var(--foreground)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.sn-md-quote': { borderLeft: '2px solid var(--border)', paddingLeft: '6px' },
  '.sn-md-fence': { color: 'var(--muted-foreground)', opacity: '0.45' },
  '.sn-md-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.82em',
    backgroundColor: 'var(--muted)',
  },
  '.sn-md-hr': {
    display: 'block',
    height: '0.6em',
    borderTop: '1px solid var(--border)',
    color: 'transparent',
    overflow: 'hidden',
  },
  /* 任务复选框（Widget DOM） */
  '.sn-task-box': {
    display: 'inline-block',
    width: '0.8em',
    height: '0.8em',
    margin: '0 0.35em 0 0.1em',
    verticalAlign: '-0.05em',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    boxSizing: 'border-box',
    backgroundColor: 'transparent',
  },
  '.sn-task-box.checked::after': {
    content: '"✓"',
    position: 'relative',
    left: '0.05em',
    top: '-0.12em',
    fontSize: '0.9em',
    lineHeight: '1',
    color: 'var(--muted-foreground)',
  },
  /* 无序列表项目符号（源文本 `- ` 的替换显示）：跟随正文色（黑色），非灰色 */
  '.sn-list-bullet': {
    display: 'inline-block',
    width: '1em',
    color: 'inherit',
  },
  /* GFM 表格（R10）：整表细边框 + muted 背景；表头行加粗 + 下边框 */
  '.sn-md-tbl': {
    backgroundColor: 'color-mix(in oklab, var(--muted) 45%, transparent)',
    borderLeft: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
    padding: '0 2px',
  },
  '.sn-md-tbl-first': { borderTop: '1px solid var(--border)' },
  '.sn-md-tbl-last': { borderBottom: '1px solid var(--border)' },
  '.sn-md-tbl-head': {
    fontWeight: '600',
    borderBottom: '1px solid var(--border)',
  },
  /* 表格分隔行（|---|---|）：整行淡色 */
  '.sn-md-tbl-sep': { color: 'var(--muted-foreground)', opacity: '0.45' },
})

/* ------------------------------------------------------------------ */
/* 装饰类单例                                                            */
/* ------------------------------------------------------------------ */

/** 淡色语法标记（始终显示） */
const dimMark = Decoration.mark({ class: 'sn-md-dim' })
/** 隐藏标记（光标行机制：非光标行标题的 # 隐藏但保留占位） */
const hiddenMark = Decoration.mark({ class: 'sn-md-hidden' })
const headingMarks = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.mark({ class: `sn-md-h${level}` }),
)
const boldMark = Decoration.mark({ class: 'sn-md-bold' })
const italicMark = Decoration.mark({ class: 'sn-md-italic' })
const codeMark = Decoration.mark({ class: 'sn-md-code' })
const linkMark = Decoration.mark({ class: 'sn-md-link' })
const quoteMark = Decoration.mark({ class: 'sn-md-quote' })
const fenceMark = Decoration.mark({ class: 'sn-md-fence' })
const codeBlockMark = Decoration.mark({ class: 'sn-md-codeblock' })
const hrMark = Decoration.mark({ class: 'sn-md-hr' })

/** 任务复选框 Widget（替换 [ ] / [x] 文本显示，源码不动） */
class TaskBoxWidget extends WidgetType {
  private checked: boolean

  constructor(checked: boolean) {
    super()
    this.checked = checked
  }

  eq(other: TaskBoxWidget): boolean {
    return other.checked === this.checked
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = this.checked ? 'sn-task-box checked' : 'sn-task-box'
    box.setAttribute('aria-hidden', 'true')
    return box
  }
}

/** 无序列表标记：源文本 `- ` 替换显示为项目符号 `•`（Obsidian 同款，源 markdown 不变） */
class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const dot = document.createElement('span')
    dot.className = 'sn-list-bullet'
    dot.textContent = '•'
    dot.setAttribute('aria-hidden', 'true')
    return dot
  }
}

/* ------------------------------------------------------------------ */
/* 语法树 → 装饰（节点映射，design.md §4）                               */
/* ------------------------------------------------------------------ */

/** 标题节点：ATXHeading1~6 */
function isHeading(name: string): boolean {
  return name.startsWith('ATXHeading')
}
function headingLevel(node: SyntaxNode): number {
  return Number(node.name.slice('ATXHeading'.length))
}

/** 区间内遍历语法树并生成装饰（深度优先先序 = 位置递增，满足 builder 顺序） */
function addRangeDecorations(
  builder: RangeSetBuilder<Decoration>,
  state: EditorState,
  from: number,
  to: number,
  cursorLine: number,
): void {
  const tree = syntaxTree(state)
  tree.iterate({
    from,
    to,
    enter: (ref) => {
      const node = ref.node
      const { name } = node
      // Table 内部不递归（维持「单元格内不 scanInline」MVP 折中，② 再放开）
      if (name === 'Table') {
        addTable(builder, state, node)
        return false
      }
      if (isHeading(name)) {
        addHeading(builder, state, node, cursorLine)
        return true
      }
      switch (name) {
        case 'FencedCode':
          addFencedCode(builder, node)
          return false
        case 'Emphasis':
          addEmphasisLike(builder, node, italicMark)
          return true
        case 'StrongEmphasis':
          addEmphasisLike(builder, node, boldMark)
          return true
        case 'InlineCode':
          addInlineCode(builder, node)
          return false
        case 'Link':
        case 'Image':
          addLink(builder, node)
          return true
        case 'ListItem':
          addListItem(builder, node)
          return true
        case 'TaskMarker': {
          // 任务标记 [x]/[ ] → 复选框 Widget（读文本判断勾选）
          const taskText = state.sliceDoc(node.from, node.to)
          const checked = taskText.length >= 3 && taskText[1].toLowerCase() === 'x'
          builder.add(node.from, node.to, Decoration.replace({ widget: new TaskBoxWidget(checked) }))
          return false
        }
        case 'Blockquote':
          addBlockquote(builder, state, node)
          return true
        case 'HorizontalRule':
          builder.add(node.from, node.to, hrMark)
          return false
      }
      return true
    },
  })
}

/** 标题：行首标记 dim（光标行）/ hidden（非光标行），内容整行标题样式 */
function addHeading(
  builder: RangeSetBuilder<Decoration>,
  state: EditorState,
  node: SyntaxNode,
  cursorLine: number,
): void {
  const level = headingLevel(node)
  const mark = node.getChild('HeaderMark')
  if (mark) {
    const isCursorLine = state.doc.lineAt(mark.from).number === cursorLine
    builder.add(mark.from, mark.to, isCursorLine ? dimMark : hiddenMark)
  }
  // 标题内容行样式（# 标记之后到行尾；嵌套（如内容含 StrongEmphasis）由子节点递归补充）
  const lineEnd = state.doc.lineAt(node.to).to
  const contentFrom = mark ? mark.to : node.from
  builder.add(contentFrom, lineEnd, headingMarks[Math.min(level - 1, 5)])
  // 注意：内容区装饰与子节点（StrongEmphasis 等）重叠合法；子节点 by iterate enter
}

/** 强调：首尾 EmphasisMark dim，中间区间样式（隐式文本按位置处理，嵌套重叠合法） */
function addEmphasisLike(
  builder: RangeSetBuilder<Decoration>,
  node: SyntaxNode,
  style: Decoration,
): void {
  const marks = collectChildren(node, 'EmphasisMark')
  if (marks.length === 0) return
  const first = marks[0]
  const last = marks[marks.length - 1]
  builder.add(first.from, first.to, dimMark)
  if (last.to > first.to) builder.add(first.to, last.from, style)
  builder.add(last.from, last.to, dimMark)
}

/** 行内代码：首尾 CodeMark dim，中间 codeMark */
function addInlineCode(builder: RangeSetBuilder<Decoration>, node: SyntaxNode): void {
  const marks = collectChildren(node, 'CodeMark')
  if (marks.length === 0) return
  const first = marks[0]
  const last = marks[marks.length - 1]
  builder.add(first.from, first.to, dimMark)
  if (last.from > first.to) builder.add(first.to, last.from, codeMark)
  builder.add(last.from, last.to, dimMark)
}

/** 链接/图片：首 LinkMark dim、文本区 linkMark、剩余（](url)）dim */
function addLink(builder: RangeSetBuilder<Decoration>, node: SyntaxNode): void {
  const marks = collectChildren(node, 'LinkMark')
  if (marks.length === 0) return
  const first = marks[0]
  const second = marks[1]
  builder.add(first.from, first.to, dimMark)
  if (second) {
    if (second.from > first.to) builder.add(first.to, second.from, linkMark)
    builder.add(second.from, node.to, dimMark)
  } else {
    builder.add(first.to, node.to, dimMark)
  }
}

/** 列表项：ListMark 替换/淡色，递归子项（嵌套层级由 ListItem 祖先链得出，④ 消费） */
function addListItem(
  builder: RangeSetBuilder<Decoration>,
  node: SyntaxNode,
): void {
  const mark = node.getChild('ListMark')
  if (!mark) return
  const contentStart = nextChildStart(node, mark)
  const isTask = !!node.getChild('Task')
  if (isTask) {
    // 任务列表：标记淡色（复选框由 TaskMarker 处理）
    builder.add(mark.from, mark.to, dimMark)
  } else {
    // 普通列表：无序标记替换为 • Widget（含后续空白），有序标记淡色保留
    const parent = node.parent
    const isOrdered = !!parent && parent.name === 'OrderedList'
    if (isOrdered) {
      builder.add(mark.from, mark.to, dimMark)
    } else {
      builder.add(mark.from, contentStart, Decoration.replace({ widget: new BulletWidget() }))
    }
  }
  // 嵌套子列表（BulletList 等）由 iterate enter 递归处理；列表标记无光标行显隐机制
}

/** 引用：QuoteMark dim + 覆盖行 quoteMark */
function addBlockquote(
  builder: RangeSetBuilder<Decoration>,
  state: EditorState,
  node: SyntaxNode,
): void {
  const mark = node.getChild('QuoteMark')
  if (mark) builder.add(mark.from, mark.to, dimMark)
  // 覆盖的每一行：整行左侧边框 + 内缩（多行引用每行生效）
  let lineNo = state.doc.lineAt(node.from).number
  const lastLine = state.doc.lineAt(node.to).number
  while (lineNo <= lastLine) {
    const line = state.doc.line(lineNo)
    builder.add(line.from, line.to, quoteMark)
    lineNo += 1
  }
}

/** 围栏代码块：开/闭 CodeMark（+CodeInfo）fenceMark，CodeText 内容 codeBlockMark */
function addFencedCode(builder: RangeSetBuilder<Decoration>, node: SyntaxNode): void {
  const marks = collectChildren(node, 'CodeMark')
  if (marks.length === 0) return
  const open = marks[0]
  const close = marks[marks.length - 1]
  const info = node.getChild('CodeInfo')
  builder.add(open.from, info ? info.to : open.to, fenceMark)
  if (close.from > open.to) builder.add(open.to, close.from, codeBlockMark)
  builder.add(close.from, close.to, fenceMark)
}

/** GFM 表格：表头行 head+first、分隔行 sep、数据行 row+last、分隔符 dim；不递归单元格 */
function addTable(
  builder: RangeSetBuilder<Decoration>,
  state: EditorState,
  node: SyntaxNode,
): void {
  const children: SyntaxNode[] = []
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) children.push(ch)
  const rows = children.filter((c) => c.name === 'TableRow')
  const isLastRow = (n: SyntaxNode) => rows.length > 0 && rows[rows.length - 1] === n

  for (const ch of children) {
    if (ch.name === 'TableHeader') {
      const line = state.doc.lineAt(ch.from)
      const cls = ['sn-md-tbl', 'sn-md-tbl-head', 'sn-md-tbl-first'].join(' ')
      builder.add(line.from, line.to, Decoration.mark({ class: cls }))
      addTableDelims(builder, ch)
    } else if (ch.name === 'TableDelimiter') {
      // 分隔行（无子节点时 table 退化，这里按行处理）
      const line = state.doc.lineAt(ch.from)
      const cls = ['sn-md-tbl', 'sn-md-tbl-sep'].join(' ')
      if (rows.length === 0) builder.add(line.from, line.to, Decoration.mark({ class: cls + ' sn-md-tbl-last' }))
      else builder.add(line.from, line.to, Decoration.mark({ class: cls }))
    } else if (ch.name === 'TableRow') {
      const line = state.doc.lineAt(ch.from)
      const cls = ['sn-md-tbl', ...(isLastRow(ch) ? ['sn-md-tbl-last'] : [])].join(' ')
      builder.add(line.from, line.to, Decoration.mark({ class: cls }))
      addTableDelims(builder, ch)
    }
  }
}

/** 表格行内分隔符 | 淡色 */
function addTableDelims(builder: RangeSetBuilder<Decoration>, row: SyntaxNode): void {
  for (let ch = row.firstChild; ch; ch = ch.nextSibling) {
    if (ch.name === 'TableDelimiter') builder.add(ch.from, ch.to, dimMark)
  }
}

/* ------------------------------------------------------------------ */
/* 辅助                                                                */
/* ------------------------------------------------------------------ */

/** 收集指定类型的直接子节点（保持位置顺序） */
function collectChildren(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    if (ch.name === name) out.push(ch)
  }
  return out
}

/** 节点内指定子节点之后的下一个兄弟起点（无则取节点末尾） */
function nextChildStart(node: SyntaxNode, after: SyntaxNode): number {
  const next = after.nextSibling
  return next ? next.from : node.to
}

/* ------------------------------------------------------------------ */
/* 全量构建（首次 / ViewPlugin 更新 / headless 测试）                     */
/* ------------------------------------------------------------------ */

/**
 * 全量构建装饰：遍历整棵语法树（lezer 解析器增量更新，遍历单遍 O(n)）。
 * 入参为 EditorState（无 DOM 依赖，可 headless 测试）。
 */
export function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const cursorLine = state.doc.lineAt(state.selection.main.head).number
  addRangeDecorations(builder, state, 0, state.doc.length, cursorLine)
  return builder.finish()
}

/* ------------------------------------------------------------------ */
/* ViewPlugin：docChanged / 光标跨行 → 全量语法树重建                    */
/* ------------------------------------------------------------------ */

function cursorLineOf(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number
}

const markdownDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    cursorLine: number

    constructor(view: EditorView) {
      this.cursorLine = cursorLineOf(view)
      this.decorations = buildDecorations(view.state)
    }

    update(update: ViewUpdate): void {
      const line = cursorLineOf(update.view)
      if (update.docChanged || line !== this.cursorLine) {
        // 全量重建（语法树遍历 0.14ms/5000 行）；DOM 增量由 CM6 compare 处理
        this.cursorLine = line
        this.decorations = buildDecorations(update.view.state)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

/** 即时渲染扩展：随编辑器 extensions 挂载 */
export const markdownDecorationExtension: Extension = markdownDecorationPlugin
