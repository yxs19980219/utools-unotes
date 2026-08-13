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
import { addTableCol, addTableRow, removeTableCol, removeTableRow } from '../../lib/tableOps.ts'

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
  /* 标题标记 #：字号随标题级别递减（需求 12），其余同 dim */
  '.sn-md-h1-mark': { color: 'var(--muted-foreground)', opacity: '0.45', fontSize: '0.9rem' },
  '.sn-md-h2-mark': { color: 'var(--muted-foreground)', opacity: '0.45', fontSize: '0.82rem' },
  '.sn-md-h3-mark': { color: 'var(--muted-foreground)', opacity: '0.45', fontSize: '0.75rem' },
  '.sn-md-h4-mark': { color: 'var(--muted-foreground)', opacity: '0.45', fontSize: '0.7rem' },
  '.sn-md-h5-mark': { color: 'var(--muted-foreground)', opacity: '0.45', fontSize: '0.65rem' },
  '.sn-md-h6-mark': { color: 'var(--muted-foreground)', opacity: '0.45', fontSize: '0.6rem' },
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
  /* 嵌套列表缩进（需求 13）：源文本缩进空白替换为固定宽度 spacer */
  '.sn-li-indent': {
    display: 'inline-block',
    width: '1em',
  },
  /* 图片（需求 9）：缩放不溢出，圆角边框；失败时底色衬托原生 alt 文本 */
  '.sn-image': {
    maxWidth: '100%',
    maxHeight: '240px',
    objectFit: 'contain',
    borderRadius: '4px',
    verticalAlign: 'middle',
    cursor: 'default',
    backgroundColor: 'color-mix(in oklab, var(--muted) 60%, transparent)',
  },
  /* 表格工具条（需求 11）：光标所在表格的表头行首悬浮按钮组 */
  '.sn-table-toolbar': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    marginRight: '6px',
    borderRadius: '4px',
    backgroundColor: 'var(--muted)',
    padding: '0 2px',
    verticalAlign: 'middle',
  },
  '.sn-table-toolbar button': {
    border: 'none',
    background: 'transparent',
    color: 'var(--muted-foreground)',
    fontSize: '0.7rem',
    lineHeight: '1.2',
    padding: '1px 3px',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  '.sn-table-toolbar button:hover': {
    backgroundColor: 'var(--accent)',
    color: 'var(--foreground)',
  },
  /* 代码块语言选择器（需求 10）：围栏行内原生 select，淡色小字 */
  '.sn-lang-picker': {
    fontSize: '0.72rem',
    color: 'var(--muted-foreground)',
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    cursor: 'pointer',
    opacity: '0.9',
    maxWidth: '8em',
  },
  '.sn-lang-picker:hover': {
    opacity: '1',
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
/** 标题标记 #：字号随级别递减（需求 12），光标行用 */
const headingMarkers = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.mark({ class: `sn-md-h${level}-mark` }),
)
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

/** 无序列表标记：源文本 `- ` 替换显示为项目符号（需求 14：嵌套深度决定符号形态） */
class BulletWidget extends WidgetType {
  /** 嵌套深度（1 = 最外层）：1 实心圆点 • / 2 空心圆点 ◦ / 3+ 实心方点 ▪ */
  readonly depth: number

  constructor(depth: number) {
    super()
    this.depth = depth
  }

  eq(other: BulletWidget): boolean {
    return other.depth === this.depth
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const dot = document.createElement('span')
    dot.className = 'sn-list-bullet'
    dot.textContent = this.depth <= 1 ? '•' : this.depth === 2 ? '◦' : '▪'
    dot.setAttribute('aria-hidden', 'true')
    return dot
  }
}

/** 嵌套列表缩进 spacer（需求 13）：替换源文本缩进空白，宽度随深度递增 */
class ListIndentWidget extends WidgetType {
  readonly depth: number

  constructor(depth: number) {
    super()
    this.depth = depth
  }

  eq(other: ListIndentWidget): boolean {
    return other.depth === this.depth
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const spacer = document.createElement('span')
    spacer.className = 'sn-li-indent'
    spacer.style.width = `${this.depth * 0.9}em`
    spacer.setAttribute('aria-hidden', 'true')
    return spacer
  }
}

/** 图片（需求 9）：替换 ![alt](src) 为 <img>；加载失败降级占位 */
class ImageWidget extends WidgetType {
  readonly src: string
  readonly alt: string

  constructor(src: string, alt: string) {
    super()
    this.src = src
    this.alt = alt
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const img = document.createElement('img')
    img.className = 'sn-image'
    img.src = this.src
    img.alt = this.alt
    img.draggable = false
    // 注意：禁止在 onerror 里改 DOM（CM6 全量监听 contentDOM 变更并回写文档，
    // 实测插入占位节点会污染源码）。加载失败时浏览器原生显示 alt 文本 + broken 图标。
    return img
  }
}

/** 常见代码块语言（需求 10）：语言选择器选项 + 工具栏默认 ```ts */
export const COMMON_CODE_LANGS = [
  'ts', 'js', 'python', 'java', 'c', 'cpp', 'go', 'rust',
  'sql', 'html', 'css', 'json', 'bash', 'md', 'yaml',
] as const

/** 代码块语言选择器（需求 10）：替换 CodeInfo 为原生 select，选择后改写围栏源码 */
class LangPickerWidget extends WidgetType {
  /** CodeInfo 节点范围（装饰生成时快照；点击时文档未变则仍准确） */
  readonly infoFrom: number
  readonly infoTo: number
  readonly current: string

  constructor(infoFrom: number, infoTo: number, current: string) {
    super()
    this.infoFrom = infoFrom
    this.infoTo = infoTo
    this.current = current
  }

  eq(other: LangPickerWidget): boolean {
    return other.infoFrom === this.infoFrom && other.current === this.current
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const sel = document.createElement('select')
    sel.className = 'sn-lang-picker'
    sel.setAttribute('aria-label', '代码块语言')
    // 无语言选项（选后移除 CodeInfo）
    const none = document.createElement('option')
    none.value = ''
    none.textContent = '语言'
    sel.appendChild(none)
    for (const lang of COMMON_CODE_LANGS) {
      const opt = document.createElement('option')
      opt.value = lang
      opt.textContent = lang
      sel.appendChild(opt)
    }
    sel.value = this.current
    sel.addEventListener('change', () => {
      const view = EditorView.findFromDOM(sel)
      if (!view) return
      const lang = sel.value
      view.dispatch({
        changes: { from: this.infoFrom, to: this.infoTo, insert: lang },
        selection: { anchor: this.infoFrom + lang.length },
      })
      view.focus()
    })
    return sel
  }
}

/** 表格工具条（需求 11）：光标所在表格的表头行首按钮组（增删行列） */
class TableToolbarWidget extends WidgetType {
  /** 表头行行首位置（装饰生成时快照；点击时文档未变则仍准确，变化后装饰已重建） */
  readonly tableFrom: number

  constructor(tableFrom: number) {
    super()
    this.tableFrom = tableFrom
  }

  eq(other: TableToolbarWidget): boolean {
    return other.tableFrom === this.tableFrom
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const bar = document.createElement('span')
    bar.className = 'sn-table-toolbar'
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', '表格操作')
    const ops: [string, string][] = [
      ['addRow', '＋行'],
      ['delRow', '－行'],
      ['addCol', '＋列'],
      ['delCol', '－列'],
    ]
    for (const [op, label] of ops) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.dataset.op = op
      btn.textContent = label
      btn.setAttribute('aria-label', label)
      btn.addEventListener('click', () => {
        const view = EditorView.findFromDOM(bar)
        if (view) applyTableOp(view, this.tableFrom, op)
      })
      bar.appendChild(btn)
    }
    return bar
  }
}

/** 表格增删行列：定位光标所在表格块 → 行级源码修改（lib/tableOps 纯函数） */
function applyTableOp(view: EditorView, tableFrom: number, op: string): void {
  const state = view.state
  const tree = syntaxTree(state)
  // side=1：pos 在节点边界（文档开头 0）时取 pos 之后的节点，避免命中根 Document
  let node = tree.resolveInner(tableFrom, 1)
  while (node.parent && node.name !== 'Table') node = node.parent
  if (node.name !== 'Table') return

  // 表格块行文本 + 范围
  const lines: string[] = []
  let lineNo = state.doc.lineAt(node.from).number
  const lastLineNo = state.doc.lineAt(node.to).number
  while (lineNo <= lastLineNo) {
    lines.push(state.doc.line(lineNo).text)
    lineNo += 1
  }
  const startPos = state.doc.lineAt(node.from).from
  const endPos = state.doc.lineAt(node.to).to

  // 删行目标：光标所在数据行；光标不在数据行则删最后一行
  let result: string[] | null = null
  if (op === 'addRow') result = addTableRow(lines)
  else if (op === 'addCol') result = addTableCol(lines)
  else if (op === 'delCol') result = removeTableCol(lines)
  else if (op === 'delRow') {
    const cursorLine = state.doc.lineAt(state.selection.main.head).number
    const dataIndex = cursorLine - (state.doc.lineAt(node.from).number + 2)
    const idx = dataIndex >= 0 && dataIndex < lines.length - 2 ? dataIndex : lines.length - 3
    result = removeTableRow(lines, Math.max(0, idx))
  }
  if (!result) return

  view.dispatch({
    changes: { from: startPos, to: endPos, insert: result.join('\n') },
    selection: { anchor: startPos },
  })
  view.focus()
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
        addTable(builder, state, node, cursorLine)
        return false
      }
      if (isHeading(name)) {
        addHeading(builder, state, node, cursorLine)
        return true
      }
      switch (name) {
        case 'FencedCode':
          addFencedCode(builder, state, node)
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
          addLink(builder, node)
          return true
        case 'Image': {
          // 完整图片语法（含 URL）→ 图片 widget（需求 9）；半成品回退链接样式
          const urlNode = node.getChild('URL')
          if (urlNode) {
            const marks = collectChildren(node, 'LinkMark')
            const altStart = marks[0] ? marks[0].to : node.from
            const altEnd = marks[1] ? marks[1].from : urlNode.from
            builder.add(
              node.from,
              node.to,
              Decoration.replace({ widget: new ImageWidget(state.sliceDoc(urlNode.from, urlNode.to), state.sliceDoc(altStart, altEnd)) }),
            )
            return false
          }
          addLink(builder, node)
          return true
        }
        case 'ListItem':
          addListItem(builder, state, node)
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
    // 光标行：级别字号标记（需求 12）；非光标行：隐藏（占位保留）
    builder.add(mark.from, mark.to, isCursorLine ? headingMarkers[level - 1] : hiddenMark)
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

/** 列表项：缩进 spacer（需求 13）+ ListMark 替换/淡色 + 嵌套符号（需求 14） */
function addListItem(
  builder: RangeSetBuilder<Decoration>,
  state: EditorState,
  node: SyntaxNode,
): void {
  const mark = node.getChild('ListMark')
  if (!mark) return
  const contentStart = nextChildStart(node, mark)
  const depth = listDepth(node)
  const line = state.doc.lineAt(node.from)
  // 行首缩进空白（嵌套列表的源文本空格）→ 固定宽度 spacer（深度递增），源文本零改动
  if (line.from < mark.from) {
    builder.add(line.from, mark.from, Decoration.replace({ widget: new ListIndentWidget(depth - 1) }))
  }
  const isTask = !!node.getChild('Task')
  if (isTask) {
    // 任务列表：标记淡色（复选框由 TaskMarker 处理）
    builder.add(mark.from, mark.to, dimMark)
  } else {
    // 普通列表：无序标记替换为嵌套符号 Widget（含后续空白），有序标记淡色保留
    const parent = node.parent
    const isOrdered = !!parent && parent.name === 'OrderedList'
    if (isOrdered) {
      builder.add(mark.from, mark.to, dimMark)
    } else {
      builder.add(mark.from, contentStart, Decoration.replace({ widget: new BulletWidget(depth) }))
    }
  }
  // 嵌套子列表（BulletList 等）由 iterate enter 递归处理；列表标记无光标行显隐机制
}

/** 列表嵌套深度：ListItem 祖先链中 BulletList/OrderedList 计数（最外层 = 1） */
function listDepth(node: SyntaxNode): number {
  let depth = 0
  let n = node.parent
  while (n) {
    if (n.name === 'BulletList' || n.name === 'OrderedList') depth += 1
    n = n.parent
  }
  return Math.max(1, depth)
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

/** 围栏代码块（需求 10）：按位置顺序 add —— 开 CodeMark → CodeInfo(语言选择器) → CodeText → 闭 CodeMark */
function addFencedCode(
  builder: RangeSetBuilder<Decoration>,
  state: EditorState,
  node: SyntaxNode,
): void {
  const marks = collectChildren(node, 'CodeMark')
  if (marks.length === 0) return
  const open = marks[0]
  const close = marks[marks.length - 1]
  builder.add(open.from, open.to, fenceMark)
  const info = node.getChild('CodeInfo')
  if (info) {
    // 语言选择器替换 CodeInfo（原生 select，选择后改写围栏源码）
    builder.add(
      info.from,
      info.to,
      Decoration.replace({
        widget: new LangPickerWidget(info.from, info.to, state.sliceDoc(info.from, info.to)),
      }),
    )
  }
  const codeText = node.getChild('CodeText')
  if (codeText) builder.add(codeText.from, codeText.to, codeBlockMark)
  builder.add(close.from, close.to, fenceMark)
}

/** GFM 表格：表头行 head+first、分隔行 sep、数据行 row+last、分隔符 dim；不递归单元格 */
function addTable(
  builder: RangeSetBuilder<Decoration>,
  state: EditorState,
  node: SyntaxNode,
  cursorLine: number,
): void {
  const children: SyntaxNode[] = []
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) children.push(ch)
  const rows = children.filter((c) => c.name === 'TableRow')
  const isLastRow = (n: SyntaxNode) => rows.length > 0 && rows[rows.length - 1] === n
  // 光标所在表格：表头行行首加工具条（需求 11），仅一个表格显示
  const tableLineFrom = state.doc.lineAt(node.from).number
  const tableLineTo = state.doc.lineAt(node.to).number
  const showToolbar = cursorLine >= tableLineFrom && cursorLine <= tableLineTo

  for (const ch of children) {
    if (ch.name === 'TableHeader') {
      const line = state.doc.lineAt(ch.from)
      const cls = ['sn-md-tbl', 'sn-md-tbl-head', 'sn-md-tbl-first'].join(' ')
      if (showToolbar) {
        builder.add(line.from, line.from, Decoration.widget({ widget: new TableToolbarWidget(node.from) }))
      }
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
