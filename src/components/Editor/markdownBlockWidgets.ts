/**
 * components/Editor/markdownBlockWidgets.ts —— 真实 Markdown 表格/代码块 Block Widget（design.md §2~3）
 *
 * 表格视觉 DOM 只是外层 Markdown 文档的投影。单元格输入挂载单行 nested
 * CodeMirror，并把变化偏移回外层 EditorView；禁止 React 或 contentEditable 直接改源码。
 * 代码块（Typora 式独立输入框，08-14）：闭合围栏由常驻 nested CM6 承载，无围栏可见。
 */
import { history, historyKeymap } from '@codemirror/commands'
import { Annotation, EditorState, RangeSetBuilder, StateField, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { keymap, Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

import {
  escapeUnescapedTablePipes,
  getTableCell,
  parseMarkdownTable,
  type MarkdownTableCell,
  type MarkdownTableModel,
} from '../../lib/markdownTableModel.ts'
import {
  addTableCol,
  addTableRow,
  removeTableCol,
  removeTableRow,
} from '../../lib/tableOps.ts'
import { COMMON_CODE_LANGS } from './markdownDecorations.ts'

export type TableOperation = 'addRow' | 'removeRow' | 'addColumn' | 'removeColumn'

/** 标记 nested cell → outer 文档的同步事务，避免后续 controller 形成回写循环。 */
export const tableSyncAnnotation = Annotation.define<boolean>()

type CellSection = 'header' | 'body'

interface ActiveCell {
  section: CellSection
  row: number
  column: number
}

interface TableRuntime {
  view: EditorView
  widget: TableWidget
  root: HTMLElement
  active: ActiveCell | null
  nested: EditorView | null
  nestedHost: HTMLElement | null
  activeElement: HTMLElement | null
  syncing: boolean
  onOuterMouseDown: (event: MouseEvent) => void
}

const runtimeByRoot = new WeakMap<HTMLElement, TableRuntime>()

function cellKey(section: CellSection, row: number, column: number): string {
  return `${section}:${row}:${column}`
}

function findCellElement(root: HTMLElement, position: ActiveCell): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `[data-cell-key="${cellKey(position.section, position.row, position.column)}"]`,
  )
}

function tablePositions(model: MarkdownTableModel): ActiveCell[] {
  const positions: ActiveCell[] = []
  for (let column = 0; column < model.header.cells.length; column += 1) {
    positions.push({ section: 'header', row: 0, column })
  }
  for (let row = 0; row < model.body.length; row += 1) {
    for (let column = 0; column < model.body[row].cells.length; column += 1) {
      positions.push({ section: 'body', row, column })
    }
  }
  return positions
}

function currentCell(runtime: TableRuntime): MarkdownTableCell | undefined {
  const active = runtime.active
  return active
    ? getTableCell(runtime.widget.model, active.section, active.row, active.column)
    : undefined
}

function closeNestedEditor(runtime: TableRuntime): void {
  if (runtime.nested) {
    runtime.nested.destroy()
    runtime.nested = null
  }
  if (runtime.activeElement) {
    runtime.activeElement.classList.remove('sn-md-table-cell-editing')
    const cell = currentCell(runtime)
    runtime.activeElement.textContent = cell?.text ?? ''
  }
  runtime.nestedHost = null
  runtime.activeElement = null
  runtime.active = null
}

function dispatchCellChange(runtime: TableRuntime, nextText: string): void {
  const cell = currentCell(runtime)
  if (!cell) return
  const insert = escapeUnescapedTablePipes(nextText.replace(/\r?\n/g, '<br>'))
  runtime.syncing = true
  try {
    runtime.view.dispatch({
      changes: { from: cell.contentFrom, to: cell.contentTo, insert },
      annotations: tableSyncAnnotation.of(true),
      userEvent: 'input',
    })
  } finally {
    runtime.syncing = false
  }
}

function activateCell(runtime: TableRuntime, position: ActiveCell, element?: HTMLElement): void {
  const cell = getTableCell(runtime.widget.model, position.section, position.row, position.column)
  const target = element ?? findCellElement(runtime.root, position)
  if (!cell || !target) return
  if (
    runtime.active &&
    cellKey(runtime.active.section, runtime.active.row, runtime.active.column) ===
      cellKey(position.section, position.row, position.column) &&
    runtime.nested
  ) {
    runtime.nested.focus()
    return
  }

  closeNestedEditor(runtime)
  runtime.active = position
  runtime.activeElement = target
  target.classList.add('sn-md-table-cell-editing')
  target.textContent = ''

  const host = runtime.root.ownerDocument.createElement('div')
  host.className = 'sn-md-table-cell-editor'
  target.appendChild(host)
  runtime.nestedHost = host

  const nestedState = EditorState.create({
    doc: cell.text,
    extensions: [
      history(),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Tab',
          run: () => {
            moveCell(runtime, 1)
            return true
          },
        },
        {
          key: 'Shift-Tab',
          run: () => {
            moveCell(runtime, -1)
            return true
          },
        },
        {
          key: 'Enter',
          run: () => {
            moveCell(runtime, 1, true)
            return true
          },
        },
        {
          key: 'Escape',
          run: () => {
            closeNestedEditor(runtime)
            runtime.view.focus()
            return true
          },
        },
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || runtime.syncing || !runtime.nested) return
        dispatchCellChange(runtime, update.state.doc.toString())
      }),
    ],
  })
  const nested = new EditorView({ state: nestedState, parent: host })
  runtime.nested = nested
  nested.focus()
}

function activateAfterRebuild(runtime: TableRuntime, position: ActiveCell): void {
  queueMicrotask(() => {
    const root = runtime.view.dom.querySelector<HTMLElement>(
      `.sn-md-table-widget[data-table-from="${runtime.widget.model.from}"]`,
    )
    const nextRuntime = root ? runtimeByRoot.get(root) : undefined
    if (nextRuntime) activateCell(nextRuntime, position)
  })
}

function moveCell(runtime: TableRuntime, delta: number, vertical = false): void {
  const positions = tablePositions(runtime.widget.model)
  const active = runtime.active
  if (!active) return
  const currentIndex = positions.findIndex(
    (position) =>
      position.section === active.section &&
      position.row === active.row &&
      position.column === active.column,
  )
  if (currentIndex < 0) return

  if (vertical) {
    if (active.section === 'header' && runtime.widget.model.body.length > 0) {
      closeNestedEditor(runtime)
      activateCell(runtime, { section: 'body', row: 0, column: active.column })
      return
    }
    const targetRow = active.row + 1
    if (targetRow < runtime.widget.model.body.length) {
      closeNestedEditor(runtime)
      activateCell(runtime, { section: 'body', row: targetRow, column: active.column })
      return
    }
    applyTableOperation(runtime, 'addRow', {
      section: 'body',
      row: runtime.widget.model.body.length - 1,
      column: active.column,
    })
    activateAfterRebuild(runtime, { section: 'body', row: runtime.widget.model.body.length, column: active.column })
    return
  }

  const nextIndex = currentIndex + delta
  if (nextIndex >= 0 && nextIndex < positions.length) {
    closeNestedEditor(runtime)
    activateCell(runtime, positions[nextIndex])
    return
  }
  if (delta > 0) {
    applyTableOperation(runtime, 'addRow', {
      section: 'body',
      row: runtime.widget.model.body.length - 1,
      column: 0,
    })
    activateAfterRebuild(runtime, { section: 'body', row: runtime.widget.model.body.length, column: 0 })
  } else {
    closeNestedEditor(runtime)
    runtime.view.focus()
  }
}

function applyTableOperation(
  runtime: TableRuntime,
  operation: TableOperation,
  active = runtime.active ?? { section: 'body', row: runtime.widget.model.body.length - 1, column: 0 },
): void {
  const model = runtime.widget.model
  const lines = model.text.split(/\r?\n/)
  const activeBodyRow = active.section === 'body' ? active.row : lines.length - 3
  let result: string[] | null = null

  if (operation === 'addRow') result = addTableRow(lines)
  else if (operation === 'removeRow') result = removeTableRow(lines, Math.max(0, activeBodyRow))
  else if (operation === 'addColumn') result = addTableCol(lines)
  else result = removeTableCol(lines)
  if (!result) return

  closeNestedEditor(runtime)
  runtime.view.dispatch({
    changes: { from: model.from, to: model.to, insert: result.join('\n') },
    userEvent: 'input',
  })
  runtime.view.focus()
}

function createTableCell(
  runtime: TableRuntime,
  cell: MarkdownTableCell,
  section: CellSection,
  row: number,
  column: number,
  header: boolean,
): HTMLElement {
  const element = runtime.root.ownerDocument.createElement(header ? 'th' : 'td')
  const key = cellKey(section, row, column)
  element.className = 'sn-md-table-cell'
  element.dataset.cellKey = key
  element.dataset.cellFrom = String(cell.from)
  element.dataset.cellTo = String(cell.to)
  element.dataset.cellSection = section
  element.dataset.cellRow = String(row)
  element.dataset.cellColumn = String(column)
  element.style.textAlign = runtime.widget.model.alignments[column] ?? 'left'
  element.textContent = cell.text
  element.addEventListener('mousedown', (event) => {
    if ((event.target as HTMLElement).closest('.sn-md-table-cell-editor')) return
    event.preventDefault()
    activateCell(runtime, { section, row, column }, element)
  })
  return element
}

function renderTable(runtime: TableRuntime): void {
  const document = runtime.root.ownerDocument
  const table = document.createElement('table')
  table.className = 'sn-md-table'
  table.setAttribute('aria-label', 'Markdown 表格')

  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  for (let column = 0; column < runtime.widget.model.header.cells.length; column += 1) {
    headerRow.appendChild(
      createTableCell(runtime, runtime.widget.model.header.cells[column], 'header', 0, column, true),
    )
  }
  thead.appendChild(headerRow)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  runtime.widget.model.body.forEach((row, rowIndex) => {
    const tr = document.createElement('tr')
    row.cells.forEach((cell, column) => {
      tr.appendChild(createTableCell(runtime, cell, 'body', rowIndex, column, false))
    })
    tbody.appendChild(tr)
  })
  table.appendChild(tbody)

  const toolbar = document.createElement('div')
  toolbar.className = 'sn-md-table-toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', '表格操作')
  const operations: Array<[TableOperation, string]> = [
    ['addRow', '＋行'],
    ['removeRow', '－行'],
    ['addColumn', '＋列'],
    ['removeColumn', '－列'],
  ]
  for (const [operation, label] of operations) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.dataset.operation = operation
    button.setAttribute('aria-label', label)
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => applyTableOperation(runtime, operation))
    toolbar.appendChild(button)
  }

  runtime.root.appendChild(toolbar)
  runtime.root.appendChild(table)
}

function sameShape(first: MarkdownTableModel, second: MarkdownTableModel): boolean {
  if (first.columnCount !== second.columnCount || first.body.length !== second.body.length) return false
  return first.rows.every((row, index) => row.cells.length === second.rows[index]?.cells.length)
}

function updateTableDOM(runtime: TableRuntime): void {
  const model = runtime.widget.model
  const cells = runtime.root.querySelectorAll<HTMLElement>('[data-cell-key]')
  for (const element of cells) {
    const section = element.dataset.cellSection as CellSection
    const row = Number(element.dataset.cellRow)
    const column = Number(element.dataset.cellColumn)
    const cell = getTableCell(model, section, row, column)
    if (!cell) continue
    element.dataset.cellFrom = String(cell.from)
    element.dataset.cellTo = String(cell.to)
    element.style.textAlign = model.alignments[column] ?? 'left'
    const active = runtime.active
    const isActive =
      !!active &&
      active.section === section &&
      active.row === row &&
      active.column === column
    if (!isActive) element.textContent = cell.text
  }

  if (runtime.active) {
    const cell = currentCell(runtime)
    const element = findCellElement(runtime.root, runtime.active)
    if (!cell || !element) {
      closeNestedEditor(runtime)
      return
    }
    runtime.activeElement = element
    if (runtime.nested && runtime.nested.state.doc.toString() !== cell.text) {
      runtime.syncing = true
      try {
        runtime.nested.dispatch({
          changes: { from: 0, to: runtime.nested.state.doc.length, insert: cell.text },
        })
      } finally {
        runtime.syncing = false
      }
    }
  }
}

/** 将完整 GFM Table 节点转换为 block replacement decoration。 */
export function buildTableBlockDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  syntaxTree(state).iterate({
    enter: (ref) => {
      const node = ref.node
      if (node.name !== 'Table') return true
      const text = state.sliceDoc(node.from, node.to)
      const model = parseMarkdownTable(text, node.from)
      if (model) {
        builder.add(
          node.from,
          node.to,
          Decoration.replace({ widget: new TableWidget(model), block: true }),
        )
      }
      return false
    },
  })
  return builder.finish()
}

const tableBlockDecorationField = StateField.define<DecorationSet>({
  create: (state) => buildTableBlockDecorations(state),
  update: (decorations, transaction) =>
    transaction.docChanged ? buildTableBlockDecorations(transaction.state) : decorations.map(transaction.changes),
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
})

export class TableWidget extends WidgetType {
  readonly model: MarkdownTableModel

  constructor(model: MarkdownTableModel) {
    super()
    this.model = model
  }

  eq(other: TableWidget): boolean {
    return this.model.from === other.model.from && this.model.text === other.model.text
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const root = view.dom.ownerDocument.createElement('div')
    root.className = 'sn-md-table-widget'
    root.dataset.tableFrom = String(this.model.from)
    root.dataset.tableTo = String(this.model.to)
    const runtime: TableRuntime = {
      view,
      widget: this,
      root,
      active: null,
      nested: null,
      nestedHost: null,
      activeElement: null,
      syncing: false,
      onOuterMouseDown: () => {},
    }
    runtime.onOuterMouseDown = (event) => {
      if (!root.contains(event.target as Node)) closeNestedEditor(runtime)
    }
    view.dom.addEventListener('mousedown', runtime.onOuterMouseDown, true)
    runtimeByRoot.set(root, runtime)
    renderTable(runtime)
    return root
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const runtime = runtimeByRoot.get(dom)
    if (!runtime || !sameShape(runtime.widget.model, this.model)) return false
    runtime.view = view
    runtime.widget = this
    dom.dataset.tableFrom = String(this.model.from)
    dom.dataset.tableTo = String(this.model.to)
    updateTableDOM(runtime)
    return true
  }

  destroy(dom: HTMLElement): void {
    const runtime = runtimeByRoot.get(dom)
    if (!runtime) return
    closeNestedEditor(runtime)
    runtime.view.dom.removeEventListener('mousedown', runtime.onOuterMouseDown, true)
    runtimeByRoot.delete(dom)
  }

  get estimatedHeight(): number {
    return Math.max(72, (this.model.body.length + 2) * 30 + 24)
  }
}

/* ------------------------------------------------------------------ */
/* 代码块 Block Widget（Typora 式独立代码输入框，08-14）                   */
/*                                                                     */
/* 闭合围栏（``` lang ... ```）→ 常驻 nested CM6 编辑器。用户只编辑代码    */
/* 内容（无围栏/无语言标记可见），变更偏移回外层源码；语言经 header select  */
/* 改写 CodeInfo。未闭合围栏（输入中间态）由 markdownDecorations 兜底装饰。 */
/* ------------------------------------------------------------------ */

/** 闭合 FencedCode 的源码模型（范围均指向外层 EditorState.doc 绝对偏移） */
export interface CodeBlockModel {
  from: number
  to: number
  /** 开围栏 ``` 范围 */
  openFrom: number
  openTo: number
  /** CodeInfo（语言）范围；null = 无语言 */
  infoFrom: number | null
  infoTo: number | null
  /** 代码内容范围（可能为空范围） */
  codeFrom: number
  codeTo: number
  /** 代码内容文本（nested editor 文档） */
  code: string
  /** 当前语言名（空串 = 无） */
  lang: string
  /** 节点全文（eq 对比用） */
  text: string
}

/** 解析闭合围栏 FencedCode 节点；未闭合（无闭 CodeMark）返回 null → 装饰兜底 */
export function parseFencedCode(state: EditorState, node: SyntaxNode): CodeBlockModel | null {
  const marks = node.getChildren('CodeMark')
  if (marks.length < 2) return null
  const open = marks[0]
  const info = node.getChild('CodeInfo')
  const codeText = node.getChild('CodeText')
  const codeFrom = codeText ? codeText.from : open.to
  let codeTo = codeText ? codeText.to : open.to
  // lezer 空代码块（```ts\n\n```）的 CodeText 含内容行尾换行（[6,7]="\n"）：
  // 排除尾随 \n 使代码范围精确落在内容行内，保证 nested 同步 round-trip 稳定
  let code = state.sliceDoc(codeFrom, codeTo)
  if (code.endsWith('\n')) {
    codeTo -= 1
    code = code.slice(0, -1)
  }
  return {
    from: node.from,
    to: node.to,
    openFrom: open.from,
    openTo: open.to,
    infoFrom: info ? info.from : null,
    infoTo: info ? info.to : null,
    codeFrom,
    codeTo,
    code,
    lang: info ? state.sliceDoc(info.from, info.to) : '',
    text: state.sliceDoc(node.from, node.to),
  }
}

/** 将完整闭合 FencedCode 节点转换为 block replacement decoration。 */
export function buildCodeBlockDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  syntaxTree(state).iterate({
    enter: (ref) => {
      const node = ref.node
      if (node.name !== 'FencedCode') return true
      const model = parseFencedCode(state, node)
      if (model) {
        builder.add(node.from, node.to, Decoration.replace({ widget: new CodeBlockWidget(model), block: true }))
      }
      return false
    },
  })
  return builder.finish()
}

const codeBlockDecorationField = StateField.define<DecorationSet>({
  create: (state) => buildCodeBlockDecorations(state),
  update: (decorations, transaction) =>
    transaction.docChanged ? buildCodeBlockDecorations(transaction.state) : decorations.map(transaction.changes),
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
})

/** 标记 nested 代码 → outer 文档的同步事务（防回写循环）。 */
const codeSyncAnnotation = Annotation.define<boolean>()

interface CodeBlockRuntime {
  view: EditorView
  widget: CodeBlockWidget
  root: HTMLElement
  nested: EditorView | null
  nestedHost: HTMLElement | null
  langSelect: HTMLSelectElement | null
  syncing: boolean
  onOuterMouseDown: (event: MouseEvent) => void
}

const codeRuntimeByRoot = new WeakMap<HTMLElement, CodeBlockRuntime>()

/** nested 输入 → 同步到外层源码的 codeFrom~codeTo 范围 */
function syncCodeChange(runtime: CodeBlockRuntime, nextCode: string): void {
  const model = runtime.widget.model
  runtime.syncing = true
  try {
    runtime.view.dispatch({
      changes: { from: model.codeFrom, to: model.codeTo, insert: nextCode },
      annotations: codeSyncAnnotation.of(true),
      userEvent: 'input',
    })
  } finally {
    runtime.syncing = false
  }
}

/** 语言选择 → 改写围栏源码的 CodeInfo（无语言时在开围栏后插入） */
function updateCodeLang(runtime: CodeBlockRuntime, lang: string): void {
  const model = runtime.widget.model
  const from = model.infoFrom ?? model.openTo
  const to = model.infoTo ?? model.openTo
  runtime.view.dispatch({
    changes: { from, to, insert: lang },
    userEvent: 'input',
  })
}

function renderCodeBlock(runtime: CodeBlockRuntime): void {
  const document = runtime.root.ownerDocument

  const header = document.createElement('div')
  header.className = 'sn-md-codeblock-header'
  const sel = document.createElement('select')
  sel.className = 'sn-lang-picker'
  sel.setAttribute('aria-label', '代码块语言')
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
  sel.value = runtime.widget.model.lang
  sel.addEventListener('change', () => updateCodeLang(runtime, sel.value))
  header.appendChild(sel)
  runtime.root.appendChild(header)
  runtime.langSelect = sel

  const host = document.createElement('div')
  host.className = 'sn-md-codeblock-body'
  runtime.root.appendChild(host)
  runtime.nestedHost = host

  const nestedState = EditorState.create({
    doc: runtime.widget.model.code,
    extensions: [
      history(),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Tab',
          run: () => {
            const view = runtime.nested
            if (!view) return true
            const { from, to } = view.state.selection.main
            view.dispatch({
              changes: { from, to, insert: '  ' },
              selection: { anchor: from + 2 },
              userEvent: 'input',
            })
            return true
          },
        },
        {
          key: 'Escape',
          run: () => {
            runtime.view.focus()
            return true
          },
        },
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || runtime.syncing || !runtime.nested) return
        syncCodeChange(runtime, update.state.doc.toString())
      }),
    ],
  })
  runtime.nested = new EditorView({ state: nestedState, parent: host })

  // 插入代码块后自动聚焦：光标位于代码范围（含空范围）→ nested 直接可输入
  const { head } = runtime.view.state.selection.main
  if (head >= runtime.widget.model.codeFrom && head <= runtime.widget.model.codeTo) {
    queueMicrotask(() => runtime.nested?.focus())
  }
}

export class CodeBlockWidget extends WidgetType {
  readonly model: CodeBlockModel

  constructor(model: CodeBlockModel) {
    super()
    this.model = model
  }

  eq(other: CodeBlockWidget): boolean {
    return this.model.from === other.model.from && this.model.text === other.model.text
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const root = view.dom.ownerDocument.createElement('div')
    root.className = 'sn-md-codeblock-widget'
    root.dataset.codeFrom = String(this.model.from)
    root.dataset.codeTo = String(this.model.to)
    const runtime: CodeBlockRuntime = {
      view,
      widget: this,
      root,
      nested: null,
      nestedHost: null,
      langSelect: null,
      syncing: false,
      onOuterMouseDown: () => {},
    }
    runtime.onOuterMouseDown = (event) => {
      // 点击代码块内部（语言选择器除外）→ 聚焦 nested 输入框
      const target = event.target as HTMLElement
      if (root.contains(target) && !target.closest('.sn-lang-picker')) {
        runtime.nested?.focus()
      }
    }
    view.dom.addEventListener('mousedown', runtime.onOuterMouseDown, true)
    codeRuntimeByRoot.set(root, runtime)
    renderCodeBlock(runtime)
    return root
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const runtime = codeRuntimeByRoot.get(dom)
    if (!runtime || runtime.widget.model.text === this.model.text) return false
    runtime.view = view
    runtime.widget = this
    dom.dataset.codeFrom = String(this.model.from)
    dom.dataset.codeTo = String(this.model.to)
    // 语言变化 → 同步 select 值
    if (runtime.langSelect && runtime.langSelect.value !== this.model.lang) {
      runtime.langSelect.value = this.model.lang
    }
    // 代码内容变化（外部编辑/撤销）→ 同步 nested 文档
    if (runtime.nested && runtime.nested.state.doc.toString() !== this.model.code) {
      runtime.syncing = true
      try {
        runtime.nested.dispatch({
          changes: { from: 0, to: runtime.nested.state.doc.length, insert: this.model.code },
        })
      } finally {
        runtime.syncing = false
      }
    }
    return true
  }

  destroy(dom: HTMLElement): void {
    const runtime = codeRuntimeByRoot.get(dom)
    if (!runtime) return
    if (runtime.nested) {
      runtime.nested.destroy()
      runtime.nested = null
    }
    runtime.view.dom.removeEventListener('mousedown', runtime.onOuterMouseDown, true)
    codeRuntimeByRoot.delete(dom)
  }

  get estimatedHeight(): number {
    const lines = this.model.code ? this.model.code.split('\n').length : 1
    return Math.max(72, lines * 22 + 36)
  }
}

/** 表格 + 代码块 Block Widget 扩展；布局装饰由 StateField 直接提供。 */
export const markdownBlockWidgetExtension: Extension = [tableBlockDecorationField, codeBlockDecorationField]
