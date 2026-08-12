/**
 * components/Editor/markdownDecorations.ts —— CodeMirror 6 即时渲染装饰（阶段 5a，路径 A）
 *
 * 契约（design.md 第 5 节 / implement.md 阶段 5）：
 * - decorations 只改显示不改内容：源码始终是纯 markdown，对输入/撤销/拼写零副作用
 *   （仅 ViewPlugin + decorations，不拦截事务）
 * - 全部样式走语义色 CSS 变量（--foreground/--muted-foreground/--border/--muted/--accent
 *   /--primary），禁硬编码色值；暗色模式随 html.dark Token（附录 A）自动切换
 * - 语法覆盖（MVP）：标题 #~####、粗体/斜体/行内代码、链接、列表（含任务复选框）、
 *   引用、分隔线、代码块围栏、GFM 表格（R10：表头加粗/边框/分隔符淡色，
 *   单元格内不 scanInline——MVP 折中，保持文本流可编辑）
 * - 光标行机制（Obsidian Live Preview 同思路）：光标行显示淡色标题标记，非光标行
 *   标记隐藏（opacity 0，占位保留）但标题样式保留；仅光标行变化或文档变化时重算
 * - 性能策略：ViewPlugin 内基于 doc 全量正则 + RangeSetBuilder 重建，千行内无感；
 *   光标移动只在光标行变化时触发重算（selectionSet 但同行的移动跳过）
 */
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { TABLE_ROW_RE, TABLE_SEP_RE } from '../../lib/markdown.ts'

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
    // R13（用户拍板）：链接 = 前景色 + 下划线（浅色模式可见；一期 --primary 浅灰不可见）
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
const headingMarks = [1, 2, 3, 4].map((level) =>
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
class BulletWidget extends WidgetType {  eq(): boolean {
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
/* 语法正则                                                             */
/* ------------------------------------------------------------------ */

/** 代码块围栏（行首 ```，支持语言标记） */
const FENCE_RE = /^\s*```/
/** 标题：#~#### 后跟空白 */
const HEADING_RE = /^(#{1,4})(\s+)/
/** 分隔线：--- 或 *** */
const HR_RE = /^\s*(?:---|\*\*\*)\s*$/
/** 引用：> 或 > 后接一空格 */
const QUOTE_RE = /^>\s?/
/** 列表标记（ul: 短横线/星号/加号，ol: 1. / 1)）：捕获「缩进 + 标记 + 空白」 */
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)])(\s+)/
/** 无序标记（-、*、+）——替换显示为 •（仅替换标记+空白，保留缩进） */
const UL_MARKER_RE = /^\s*[-*+]\s+/
/** 任务列表：列表标记 + [ ]/[x] */
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/
/** 行内代码片断（不含换行）；用于先从行文本中切出，避免其余行内正则误命中 */
const CODE_SPAN_RE = /`[^`\n]+`/g
/**
 * 行内语法（粗体/斜体/链接）：按「先粗后斜」顺序匹配同一位置的最长形态。
 * 行内代码由 CODE_SPAN_RE 先行切出，故此处不包含反引号形态。
 */
const INLINE_RE =
  /(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)|(\[[^\]\n]+\]\([^)\n]+\))/g

/**
 * 标记一行表格（R10）：整行边框/背景 + 表头加粗；行内 `|` 分隔符淡色。
 * 单元格内不 scanInline（MVP 折中：保持文本流可编辑，不做单元格内语法）。
 */
function markTableRow(
  builder: RangeSetBuilder<Decoration>,
  line: { text: string; from: number; to: number },
  kind: 'head' | 'sep' | 'row',
  isFirst: boolean,
  isLast: boolean,
): void {
  const classes = ['sn-md-tbl']
  if (kind === 'head') {
    classes.push('sn-md-tbl-head')
    if (isFirst) classes.push('sn-md-tbl-first')
  } else if (kind === 'sep') {
    classes.push('sn-md-tbl-sep')
  }
  if (isLast) classes.push('sn-md-tbl-last')
  builder.add(line.from, line.to, Decoration.mark({ class: classes.join(' ') }))
  // 单元格分隔符 `|` 淡色（分隔行整行已淡色，跳过）
  if (kind !== 'sep') {
    let idx = line.text.indexOf('|')
    while (idx !== -1) {
      builder.add(line.from + idx, line.from + idx + 1, dimMark)
      idx = line.text.indexOf('|', idx + 1)
    }
  }
}

/**
 * 块级解析辅助：当前行（n）是表格分隔行且上一行是表头行 → 收集整表并标记，
 * 返回表结束后的下一行号（已处理的行跳过）；非表格返回 n。
 */
function scanTable(
  builder: RangeSetBuilder<Decoration>,
  doc: { lines: number; line(n: number): { text: string; from: number; to: number } },
  n: number,
): number {
  const sepLine = doc.line(n)
  if (n === 1 || !TABLE_SEP_RE.test(sepLine.text)) return n
  const headLine = doc.line(n - 1)
  if (!TABLE_ROW_RE.test(headLine.text)) return n
  // 收集后续数据行
  let last = n + 1
  while (last <= doc.lines && TABLE_ROW_RE.test(doc.line(last).text)) last++
  // 表头（表格第一行 = 上一行）
  markTableRow(builder, headLine, 'head', true, false)
  // 分隔行（无数据行时分隔行闭合下边框）
  markTableRow(builder, sepLine, 'sep', false, last === n + 1)
  // 数据行（最后一行闭合下边框）
  for (let r = n + 1; r < last; r++) {
    markTableRow(builder, doc.line(r), 'row', false, r === last - 1)
  }
  return last
}

/* ------------------------------------------------------------------ */
/* 扫描器                                                               */
/* ------------------------------------------------------------------ */

/**
 * 行内扫描（粗体/斜体/行内代码/链接）。
 * 先按 CODE_SPAN_RE 切出代码片断（整体装饰：反引号淡色、内容 code 样式），
 * 再对非代码段跑 INLINE_RE；两者位置单调递增，满足 RangeSetBuilder 顺序要求。
 */
function scanInline(
  builder: RangeSetBuilder<Decoration>,
  base: number,
  text: string,
): void {
  let pos = 0
  CODE_SPAN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CODE_SPAN_RE.exec(text)) !== null) {
    if (m.index > pos) scanInlinePlain(builder, base + pos, text.slice(pos, m.index))
    const spanFrom = base + m.index
    const spanTo = spanFrom + m[0].length
    builder.add(spanFrom, spanFrom + 1, dimMark) // 起始 `
    builder.add(spanFrom + 1, spanTo - 1, codeMark) // 内容
    builder.add(spanTo - 1, spanTo, dimMark) // 结束 `
    pos = m.index + m[0].length
  }
  if (pos < text.length) scanInlinePlain(builder, base + pos, text.slice(pos))
}

/** 非代码段的行内语法（粗体/斜体/链接） */
function scanInlinePlain(
  builder: RangeSetBuilder<Decoration>,
  base: number,
  text: string,
): void {
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(text)) !== null) {
    const segFrom = base + m.index
    const segTo = segFrom + m[0].length
    if (m[1]) {
      // 粗体 **x** / __x__
      builder.add(segFrom, segFrom + 2, dimMark)
      builder.add(segFrom + 2, segTo - 2, boldMark)
      builder.add(segTo - 2, segTo, dimMark)
    } else if (m[2]) {
      // 斜体 *x* / _x_
      builder.add(segFrom, segFrom + 1, dimMark)
      builder.add(segFrom + 1, segTo - 1, italicMark)
      builder.add(segTo - 1, segTo, dimMark)
    } else if (m[3]) {
      // 链接 [text](url)
      const textEnd = m[0].indexOf('](')
      builder.add(segFrom, segFrom + 1, dimMark) // [
      builder.add(segFrom + 1, segFrom + textEnd, linkMark) // text
      builder.add(segFrom + textEnd, segTo, dimMark) // ](url)
    }
  }
}

/**
 * 全量构建装饰：逐行扫描，块级语法优先（围栏 > 标题 > 分隔线 > 引用 >
 * 任务列表 > 列表 > 行内），行内语法对所有块内容行生效（如标题/列表内的粗体）。
 * 入参为 EditorState（无 DOM 依赖，可 headless 测试）。
 */
export function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc } = state
  // 光标行（仅标题标记的「显示/隐藏」依赖它）
  const cursorLine = doc.lineAt(state.selection.main.head).number
  let inFence = false

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const { text, from } = line

    // 围栏代码块：围栏行整体淡色，内部行等宽 + 背景
    if (FENCE_RE.test(text)) {
      builder.add(from, line.to, fenceMark)
      inFence = !inFence
      continue
    }
    if (inFence) {
      builder.add(from, line.to, codeBlockMark)
      continue
    }

    // 标题：行首标记淡色（光标行）/ 隐藏（非光标行），内容整行标题样式 + 行内扫描
    const h = HEADING_RE.exec(text)
    if (h) {
      const markLen = h[1].length + h[2].length
      builder.add(from, from + markLen, n === cursorLine ? dimMark : hiddenMark)
      builder.add(from + markLen, line.to, headingMarks[h[1].length - 1])
      scanInline(builder, from + markLen, text.slice(markLen))
      continue
    }

    // GFM 表格（R10）：分隔行 + 上一行表头 → 整表标记（表头加粗/边框/分隔符淡色）
    const tableNext = scanTable(builder, doc, n)
    if (tableNext !== n) {
      n = tableNext - 1
      continue
    }

    // 分隔线：整行渲染为水平线（文本透明 + 上边框）
    if (HR_RE.test(text)) {
      builder.add(from, line.to, hrMark)
      continue
    }

    // 引用：行首 > 淡色，整行左侧边框 + 内缩
    if (QUOTE_RE.test(text)) {
      builder.add(from, from + 1, dimMark)
      builder.add(from, line.to, quoteMark)
      if (text.length > 1) scanInline(builder, from + 1, text.slice(1))
      continue
    }

    // 任务列表：标记淡色 + [ ]/[x] 替换为复选框 Widget
    const task = TASK_RE.exec(text)
    if (task) {
      const markerLen = task[1].length
      builder.add(from, from + markerLen, dimMark)
      const boxFrom = from + markerLen
      builder.add(
        boxFrom,
        boxFrom + 3,
        Decoration.replace({ widget: new TaskBoxWidget(task[2].toLowerCase() === 'x') }),
      )
      scanInline(builder, boxFrom + 3, text.slice(markerLen + 3))
      continue
    }

    // 普通列表：无序标记替换为 •（显示），有序标记淡色保留；缩进始终保留（嵌套列表）
    const list = LIST_MARKER_RE.exec(text)
    if (list) {
      const indentLen = list[1].length
      const markerLen = indentLen + list[2].length + list[3].length
      if (UL_MARKER_RE.test(text)) {
        builder.add(from + indentLen, from + markerLen, Decoration.replace({ widget: new BulletWidget() }))
      } else {
        builder.add(from + indentLen, from + markerLen, dimMark)
      }
      scanInline(builder, from + markerLen, text.slice(markerLen))
      continue
    }

    // 纯文本行
    scanInline(builder, from, text)
  }
  return builder.finish()
}

/* ------------------------------------------------------------------ */
/* ViewPlugin：文档变化或光标行变化时重建                                 */
/* ------------------------------------------------------------------ */

function cursorLineOf(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number
}

function buildFor(view: EditorView): DecorationSet {
  return buildDecorations(view.state)
}

const markdownDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    cursorLine: number

    constructor(view: EditorView) {
      this.cursorLine = cursorLineOf(view)
      this.decorations = buildFor(view)
    }

    update(update: ViewUpdate): void {
      const line = cursorLineOf(update.view)
      // 性能：光标在同一行内移动（selectionSet 但 cursorLine 不变）不重算
      if (update.docChanged || line !== this.cursorLine) {
        this.cursorLine = line
        this.decorations = buildFor(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

/** 即时渲染扩展：随编辑器 extensions 挂载 */
export const markdownDecorationExtension: Extension = markdownDecorationPlugin
