/**
 * components/Editor/markdownBlockWidgets.ts —— 真实 Markdown 表格 Block Widget（design.md §2~3）
 *
 * 表格视觉 DOM 只是外层 Markdown 文档的投影。单元格输入挂载单行 nested
 * CodeMirror，并把变化偏移回外层 EditorView；禁止 React 或 contentEditable 直接改源码。
 */
import { history, historyKeymap } from '@codemirror/commands'
import { Annotation, EditorState, RangeSetBuilder, StateField, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { keymap, Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

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

/** 表格 Block Widget 扩展；布局装饰由 StateField 直接提供。 */
export const markdownBlockWidgetExtension: Extension = tableBlockDecorationField

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
