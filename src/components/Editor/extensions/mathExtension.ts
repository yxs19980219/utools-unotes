/**
 * components/Editor/extensions/mathExtension.ts —— 自研公式即时渲染（标准 `$...$` / `$$...$$`）
 *
 * 任务 08-14-editor-cm6-research（D3）：atomic-editor 不内置公式，codemirror-live-markdown
 * 的 mathPlugin 只支持 Obsidian 语法（`` `$x$` `` 行内 / ```math 围栏块），用户拍板用
 * **标准 `$...$` / `$$...$$`**，故自研本轻量扩展（独立文件，可整体替换）。
 *
 * 设计要点：
 * - 语法边界（对齐 JupyterLab/Strata 惯例）：
 *   - 行内 `$x$`：开 `$` 非转义（`\$` 不算）、开 `$` 后紧跟非空白、闭 `$` 前非空白、
 *     内容不含 `$`/换行且非空。`a $ b`、`$ a$`、`$a $` 均不渲染（保持源码）；未闭合 `$` 不渲染。
 *   - 块级：整行 `$$content$$`（单行）或 `$$` 起止行（多行）；块内容内不得含 `$`。
 *     `$$` 出现在行中（非行首）按行内规则拒绝（与 `$` 互斥，保留源码）。
 *   - 行内/块歧义：先按行扫块级（块优先），剩余文本再扫行内，互不重叠。
 *   - 代码围栏/行内代码/链接/图片内不渲染：只扫 lezer 的 Paragraph / ATXHeading* 节点，
 *     并剔除 InlineCode / Link / Image 子树区间（表格天然排除——不是 Paragraph）。
 * - 光标行揭示（对齐 atomic inlinePreview）：selection 覆盖的行显示源码；块公式被光标
 *   覆盖任一行则整块显示源码。只读态（归档）恒渲染不揭示。
 * - 点击渲染结果 → selection 移入公式源码（revealPos），恢复编辑；只读态点击不干预。
 * - KaTeX：renderToString + 内容缓存；错误显示 .cm-math-error 而非抛异常。
 *   CSS 走 katex/dist/katex.min.css（vite katexWoff2Only 裁剪字体）。
 */
import { syntaxTree } from '@codemirror/language'
import {
  RangeSetBuilder,
  StateField,
  type EditorState,
  type Extension,
  type Text,
} from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/* ------------------------------------------------------------------ */
/* KaTeX 渲染（内容缓存：同一公式只 renderToString 一次）               */
/* ------------------------------------------------------------------ */

const mathCache = new Map<string, string>()

function renderMath(source: string, displayMode: boolean): string {
  const key = `${displayMode ? 'b' : 'i'}:${source}`
  const cached = mathCache.get(key)
  if (cached !== undefined) return cached
  let html: string
  try {
    html = katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: false,
      errorColor: '#d45b5b',
    })
  } catch {
    html = '<span class="cm-math-error">[公式错误]</span>'
  }
  mathCache.set(key, html)
  return html
}

/* ------------------------------------------------------------------ */
/* Widget                                                              */
/* ------------------------------------------------------------------ */

class MathWidget extends WidgetType {
  private readonly source: string
  private readonly isBlock: boolean
  private readonly revealPos: number
  /** widget 覆盖的源行数（min-height 基准，保持 heightmap 与 DOM 一致） */
  private readonly lineCount: number

  constructor(source: string, isBlock: boolean, revealPos: number, lineCount = 1) {
    super()
    this.source = source
    this.isBlock = isBlock
    this.revealPos = revealPos
    this.lineCount = lineCount
  }

  eq(other: MathWidget): boolean {
    return other.source === this.source && other.isBlock === this.isBlock
  }

  toDOM(): HTMLElement {
    const dom = document.createElement(this.isBlock ? 'div' : 'span')
    dom.className = this.isBlock ? 'cm-math-block' : 'cm-math-inline'
    dom.innerHTML = renderMath(this.source, this.isBlock)
    // 多行块替换 N 行源码，widget 高度必须对齐 N 行（否则 heightmap 与 DOM 不一致，
    // 块下方方向键/点击的 Y→文档位置映射全部错位——实测会吸到块起点）
    if (this.isBlock && this.lineCount > 1) {
      dom.style.minHeight = `calc(${this.lineCount} * var(--atomic-editor-body-leading, 1.7) * 1em)`
    }
    // 点击渲染结果 → 光标移入公式源码（selection 变化即重建装饰揭示源码行）。
    // preventDefault 使 CM6 的 mousedown 处理整体跳过，避免光标被放到被替换区间之外。
    dom.addEventListener('mousedown', (e) => {
      const view = EditorView.findFromDOM(dom)
      if (!view || view.state.readOnly) return
      e.preventDefault()
      view.dispatch({
        selection: { anchor: this.revealPos },
        effects: EditorView.scrollIntoView(this.revealPos),
      })
      view.focus()
    })
    return dom
  }

  ignoreEvent(): boolean {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 语法扫描                                                            */
/* ------------------------------------------------------------------ */

interface MathRange {
  from: number
  to: number
  isBlock: boolean
  content: string
}

/** 行内公式（内容不含 $/换行；开 $ 后非空白、闭 $ 前非空白、非转义） */
const INLINE_MATH_RE = /(?<![\\$])\$(?![\s$])([^$\n]+?)(?<!\s)\$/g

/** 单个节点（Paragraph/ATXHeading）内扫描，产出公式区间（from/to 含 `$` 定界符） */
function scanNode(
  doc: Text,
  nodeFrom: number,
  nodeTo: number,
  skipChildren: { from: number; to: number }[],
  out: MathRange[],
): void {
  // 段落级块扫描：整行 $$content$$（单行）/ $$…$$（多行）——先块后行内
  let blockFrom: number | null = null
  let pos = nodeFrom
  while (pos <= nodeTo && pos < doc.length) {
    const line = doc.lineAt(pos)
    if (line.from >= nodeTo) break
    const lineStart = line.from
    const lineEnd = Math.min(line.to, nodeTo)
    const text = doc.sliceString(lineStart, lineEnd)

    if (blockFrom !== null) {
      // 多行块：找闭合行（trim 后恰为 `$$`）
      if (/^\s*\$\$\s*$/.test(text)) {
        out.push({
          from: blockFrom,
          to: line.to,
          isBlock: true,
          content: doc.sliceString(doc.lineAt(blockFrom).to + 1, line.from).trim(),
        })
        blockFrom = null
        pos = line.to + 1
        continue
      }
      pos = line.to + 1
      continue
    }

    // 单行块：整行 $$content$$（内容不含 $）
    const single = /^\s*\$\$([^$\n]+)\$\$\s*$/.exec(text)
    if (single) {
      out.push({
        from: lineStart + text.indexOf('$$'),
        to: lineEnd,
        isBlock: true,
        content: single[1],
      })
      pos = line.to + 1
      continue
    }
    // 多行块起行：trim 后恰为 `$$`
    if (/^\s*\$\$\s*$/.test(text)) {
      blockFrom = lineStart
      pos = line.to + 1
      continue
    }
    pos = line.to + 1
  }

  // 行内扫描：剔除块区间 + 子树区间（InlineCode/Link/Image）后逐段正则
  const blocks: { from: number; to: number }[] = out.filter((r) => r.isBlock)
  let scan = nodeFrom
  while (scan < nodeTo) {
    const nextBlock = blocks.find((b) => b.from >= scan)
    const blockStart = nextBlock ? nextBlock.from : nodeTo
    scanLineSegments(doc, scan, blockStart, skipChildren, out)
    scan = nextBlock ? nextBlock.to + 1 : nodeTo
  }
}

/** 在 [from, to) 逐行逐段（剔除 skipChildren 交集）执行行内公式正则 */
function scanLineSegments(
  doc: Text,
  from: number,
  to: number,
  skipChildren: { from: number; to: number }[],
  out: MathRange[],
): void {
  let pos = from
  while (pos < to) {
    const line = doc.lineAt(pos)
    const lineStart = line.from
    const lineEnd = Math.min(line.to, to)
    // 本行与 skip 区间的互补段
    const cuts: number[] = [lineStart]
    for (const s of skipChildren) {
      if (s.to <= lineStart || s.from >= lineEnd) continue
      const a = Math.max(s.from, lineStart)
      const b = Math.min(s.to, lineEnd)
      cuts.push(a, b)
    }
    cuts.push(lineEnd)
    for (let i = 0; i < cuts.length; i += 2) {
      const segStart = cuts[i]
      const segEnd = cuts[i + 1]
      if (segEnd <= segStart) continue
      INLINE_MATH_RE.lastIndex = 0
      const segText = doc.sliceString(segStart, segEnd)
      let m: RegExpExecArray | null
      while ((m = INLINE_MATH_RE.exec(segText)) !== null) {
        out.push({
          from: segStart + m.index,
          to: segStart + m.index + m[0].length,
          isBlock: false,
          content: m[1],
        })
      }
    }
    pos = line.to + 1
  }
}

/** selection 覆盖的所有行号（光标行揭示用） */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    if (range.empty) {
      lines.add(state.doc.lineAt(range.head).number)
    } else {
      const a = state.doc.lineAt(range.from).number
      const b = state.doc.lineAt(range.to).number
      for (let n = a; n <= b; n++) lines.add(n)
    }
  }
  return lines
}

/** 区间覆盖的行号集合（块公式跨越行数） */
function rangeLines(doc: Text, from: number, to: number): number[] {
  const a = doc.lineAt(Math.min(from, doc.length)).number
  const b = doc.lineAt(Math.min(to, doc.length)).number
  const out: number[] = []
  for (let n = a; n <= b; n++) out.push(n)
  return out
}

/* ------------------------------------------------------------------ */
/* StateField：装饰构建（block widget 必须来自 StateField，CM6 规则）  */
/* ------------------------------------------------------------------ */

function buildMathDecorations(state: EditorState): DecorationSet {
  const doc = state.doc
  const builder = new RangeSetBuilder<Decoration>()
  const skip = new Set(['InlineCode', 'Link', 'Image'])
  const lines = activeLines(state)
  const readOnly = state.readOnly

  const ranges: MathRange[] = []
  const skipChildren: { from: number; to: number }[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name
      if (name === 'Paragraph' || /^ATXHeading\d$/.test(name)) {
        skipChildren.length = 0
        for (const childName of skip) {
          for (const child of node.node.getChildren(childName)) {
            skipChildren.push({ from: child.from, to: child.to })
          }
        }
        const before = ranges.length
        scanNode(doc, node.from, node.to, skipChildren, ranges)
        // 光标行揭示：块整块源码 / 行内本行源码；只读恒渲染
        for (let i = before; i < ranges.length; i++) {
          const r = ranges[i]
          if (readOnly) continue
          if (r.isBlock) {
            if (rangeLines(doc, r.from, r.to).some((n) => lines.has(n))) {
              ranges[i] = { ...r, content: '' }
            }
          } else if (lines.has(doc.lineAt(r.from).number)) {
            ranges[i] = { ...r, content: '' }
          }
        }
      }
    },
  })

  // 已标记 content='' 的区间（reveal 状态）不装饰
  const sorted = ranges
    .filter((r) => r.content !== '')
    .sort((a, b) => a.from - b.from || a.to - b.to)

  for (const r of sorted) {
    if (r.isBlock) {
      // block widget 替换块内容（不含行尾换行）：换行符保留，光标在块后时 selection
      // 不会因 replace 覆盖换行而丢失（实测 replace 含换行 → Enter 后 selection 空，
      // 后续输入窜到文档开头）
      builder.add(
        r.from,
        r.to,
        Decoration.replace({
          widget: new MathWidget(r.content, true, r.from + 2, rangeLines(doc, r.from, r.to).length),
          block: true,
        }),
      )
    } else {
      builder.add(
        r.from,
        r.to,
        Decoration.replace({ widget: new MathWidget(r.content, false, r.from + 1) }),
      )
    }
  }
  return builder.finish()
}

/** 公式即时渲染扩展：标准 `$...$` / `$$...$$`（光标行显示源码） */
export const mathExtension: Extension = StateField.define<DecorationSet>({
  create(state) {
    return buildMathDecorations(state)
  },
  update(decorations, tr) {
    if (tr.docChanged || tr.selection || tr.reconfigured) {
      return buildMathDecorations(tr.state)
    }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})
