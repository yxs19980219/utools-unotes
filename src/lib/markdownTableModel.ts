/**
 * lib/markdownTableModel.ts —— GFM Markdown 表格模型与源码范围契约（design.md §3）
 *
 * Markdown 表格仍以纯文本为唯一真相。本模块只负责解析/序列化和源码范围，
 * 不依赖 DOM、React 或 EditorView，供表格 Widget、结构操作和 headless smoke 共用。
 */

export type MarkdownTableRowKind = 'header' | 'delimiter' | 'body'

export interface MarkdownTableCell {
  row: number
  column: number
  /** 去掉首尾空白、还原 `\\|` 后的编辑文本 */
  text: string
  /** 单元格在源码中的绝对范围（包含单元格两侧空白） */
  from: number
  to: number
  /** 单元格内容的绝对范围（去掉首尾空白） */
  contentFrom: number
  contentTo: number
}

export interface MarkdownTableRow {
  kind: MarkdownTableRowKind
  row: number
  from: number
  to: number
  cells: MarkdownTableCell[]
}

export interface MarkdownTableModel {
  from: number
  to: number
  text: string
  columnCount: number
  rows: MarkdownTableRow[]
  header: MarkdownTableRow
  delimiter: MarkdownTableRow
  body: MarkdownTableRow[]
  alignments: Array<'left' | 'center' | 'right' | null>
}

interface TableLine {
  text: string
  from: number
  to: number
}

export interface MarkdownTableRowCell {
  from: number
  to: number
  contentFrom: number
  contentTo: number
  text: string
}

/** 行内未转义 `|` 的位置；反斜杠数量为奇数时 `|` 属于单元格内容。 */
function unescapedPipePositions(line: string): number[] {
  const positions: number[] = []
  let backslashes = 0
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '\\') {
      backslashes += 1
      continue
    }
    if (char === '|' && backslashes % 2 === 0) positions.push(i)
    backslashes = 0
  }
  return positions
}

function trimBounds(value: string, from: number, to: number): { from: number; to: number } {
  const raw = value.slice(from, to)
  const left = raw.length - raw.trimStart().length
  const right = raw.length - raw.trimEnd().length
  return {
    from: from + left,
    to: Math.max(from + left, to - right),
  }
}

/** `\\|` 是表格内容中的字面管道符，解析给单元格编辑器时还原为 `|`。 */
export function unescapeTablePipes(text: string): string {
  return text.replace(/\\\|/g, '|')
}

/** 只转义尚未转义的管道符，避免重复序列化产生 `\\\\|`。 */
export function escapeUnescapedTablePipes(text: string): string {
  let output = ''
  let backslashes = 0
  for (const char of text) {
    if (char === '\\') {
      output += char
      backslashes += 1
      continue
    }
    if (char === '|' && backslashes % 2 === 0) output += '\\|'
    else output += char
    backslashes = 0
  }
  return output
}

/**
 * 解析单行 Markdown 表格的单元格。
 * 返回的 from/to 是相对当前行的偏移，text 已 trim 并还原转义管道符。
 */
export function parseTableRowCells(line: string): MarkdownTableRowCell[] {
  const pipes = unescapedPipePositions(line)
  if (pipes.length === 0) return []

  const lastPipe = pipes[pipes.length - 1]
  const hasTrailingPipe = line.slice(lastPipe + 1).trim() === ''
  const delimiterCount = hasTrailingPipe ? pipes.length - 1 : pipes.length
  const cells: MarkdownTableRowCell[] = []
  let segmentFrom = pipes[0] === 0 ? 1 : 0

  for (let i = 0; i < delimiterCount; i += 1) {
    const pipe = pipes[i]
    if (pipe < segmentFrom) continue
    cells.push(makeRawCell(line, segmentFrom, pipe))
    segmentFrom = pipe + 1
  }

  if (hasTrailingPipe) cells.push(makeRawCell(line, segmentFrom, lastPipe))
  else cells.push(makeRawCell(line, segmentFrom, line.length))

  return cells
}

function makeRawCell(line: string, from: number, to: number): MarkdownTableRowCell {
  const content = trimBounds(line, from, to)
  return {
    from,
    to,
    contentFrom: content.from,
    contentTo: content.to,
    text: unescapeTablePipes(line.slice(content.from, content.to)),
  }
}

function tableLines(text: string, absoluteFrom: number): TableLine[] {
  const lines: TableLine[] = []
  let localFrom = 0

  while (localFrom <= text.length) {
    const newline = text.indexOf('\n', localFrom)
    const rawTo = newline < 0 ? text.length : newline
    const lineTo = rawTo > localFrom && text[rawTo - 1] === '\r' ? rawTo - 1 : rawTo
    lines.push({
      text: text.slice(localFrom, lineTo),
      from: absoluteFrom + localFrom,
      to: absoluteFrom + lineTo,
    })
    if (newline < 0) break
    localFrom = newline + 1
  }

  return lines
}

function isDelimiterCell(text: string): boolean {
  return /^:?-{3,}:?$/.test(text.trim())
}

export function isTableDelimiterRow(line: string): boolean {
  const cells = parseTableRowCells(line)
  return cells.length >= 2 && cells.every((cell) => isDelimiterCell(cell.text))
}

function alignmentOf(text: string): 'left' | 'center' | 'right' | null {
  const value = text.trim()
  const left = value.startsWith(':')
  const right = value.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return null
}

function makeRow(line: TableLine, kind: MarkdownTableRowKind, row: number): MarkdownTableRow | null {
  const rawCells = parseTableRowCells(line.text)
  if (rawCells.length < 2) return null
  return {
    kind,
    row,
    from: line.from,
    to: line.to,
    cells: rawCells.map((cell, column) => ({
      row,
      column,
      text: cell.text,
      from: line.from + cell.from,
      to: line.from + cell.to,
      contentFrom: line.from + cell.contentFrom,
      contentTo: line.from + cell.contentTo,
    })),
  }
}

/**
 * 解析一段完整 GFM 表格。
 * `from` 用于把返回的行/单元格范围映射到外层 EditorState.doc 的绝对偏移。
 */
export function parseMarkdownTable(text: string, from = 0): MarkdownTableModel | null {
  const lines = tableLines(text, from)
  if (lines.length < 2 || lines.some((line) => line.text.trim() === '')) return null

  const header = makeRow(lines[0], 'header', 0)
  const delimiter = makeRow(lines[1], 'delimiter', 1)
  if (!header || !delimiter || !isTableDelimiterRow(lines[1].text)) return null
  if (header.cells.length !== delimiter.cells.length) return null

  const body: MarkdownTableRow[] = []
  for (let i = 2; i < lines.length; i += 1) {
    const row = makeRow(lines[i], 'body', i)
    if (!row) return null
    body.push(row)
  }

  return {
    from,
    to: from + text.length,
    text,
    columnCount: header.cells.length,
    rows: [header, delimiter, ...body],
    header,
    delimiter,
    body,
    alignments: delimiter.cells.map((cell) => alignmentOf(cell.text)),
  }
}

function serializedCell(text: string): string {
  return escapeUnescapedTablePipes(text.replace(/\r?\n/g, '<br>').trim())
}

function serializeRow(cells: string[]): string {
  return `| ${cells.map(serializedCell).join(' | ')} |`
}

export interface MarkdownTableData {
  header: string[]
  delimiter: string[]
  body: string[][]
}

/** 将表格数据规范化为稳定的 GFM Markdown。 */
export function serializeMarkdownTableData(data: MarkdownTableData): string {
  return [serializeRow(data.header), serializeRow(data.delimiter), ...data.body.map(serializeRow)].join('\n')
}

/** 将模型规范化为稳定的 GFM Markdown；缺失的数据单元格补为空文本。 */
export function serializeMarkdownTable(model: MarkdownTableModel): string {
  const header = model.header.cells.slice(0, model.columnCount).map((cell) => cell.text)
  const delimiter = model.delimiter.cells.slice(0, model.columnCount).map((cell) => cell.text)
  const body = model.body.map((row) =>
    Array.from({ length: model.columnCount }, (_, column) => row.cells[column]?.text ?? ''),
  )
  return serializeMarkdownTableData({ header, delimiter, body })
}

/** 通过逻辑坐标读取单元格；供后续 nested editor controller 使用。 */
export function getTableCell(
  model: MarkdownTableModel,
  section: 'header' | 'body',
  row: number,
  column: number,
): MarkdownTableCell | undefined {
  const target = section === 'header' ? model.header : model.body[row]
  return target?.cells[column]
}
