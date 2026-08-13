/**
 * lib/tableOps.ts —— 表格行级操作纯函数（需求 11，08-13-wysiwyg-toolbar）
 *
 * 输入输出均为表格的行文本数组：[表头行, 分隔行, ...数据行]。
 * 非法操作（删到边界）返回 null，调用方忽略。
 * 单元格拼接统一 `| a | b |` 格式（trim 单元格文本）。
 */

/** 行 → 单元格数组（去首尾 |，逐格 trim） */
export function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())
}

/** 单元格数组 → 行文本 */
export function joinCells(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

/** 表列数（按分隔行计算；解析失败返回 0） */
export function tableColCount(lines: string[]): number {
  const sep = lines[1]
  if (!sep) return 0
  const cells = tableCells(sep).filter((c) => c !== '')
  return cells.length
}

/** 表头行号（0-based，表结构首行） */
export const HEADER_INDEX = 0
/** 分隔行号 */
export const SEP_INDEX = 1
/** 首个数据行号 */
export const FIRST_ROW_INDEX = 2

/** 末尾追加一行数据（列数对齐表头） */
export function addTableRow(lines: string[]): string[] | null {
  const cols = tableColCount(lines)
  if (cols <= 0) return null
  const newLine = joinCells(Array.from({ length: cols }, () => '内容'))
  return [...lines, newLine]
}

/** 删除指定数据行（dataRowIndex 0-based 数据行序号）；仅剩 1 行数据时拒绝 */
export function removeTableRow(lines: string[], dataRowIndex: number): string[] | null {
  const rowIndex = FIRST_ROW_INDEX + dataRowIndex
  if (rowIndex >= lines.length || lines.length - FIRST_ROW_INDEX <= 1) return null
  return lines.filter((_, i) => i !== rowIndex)
}

/** 末尾追加一列（表头 新列N / 分隔行 --- / 数据行 内容）；列数上限 10 */
export function addTableCol(lines: string[]): string[] | null {
  const cols = tableColCount(lines)
  if (cols <= 0 || cols >= 10) return null
  return lines.map((line, i) => {
    const cells = tableCells(line)
    if (i === HEADER_INDEX) cells.push(`新列${cols + 1}`)
    else if (i === SEP_INDEX) cells.push('---')
    else cells.push('内容')
    return joinCells(cells)
  })
}

/** 移除最后一列；列数 ≤ 2 时拒绝 */
export function removeTableCol(lines: string[]): string[] | null {
  const cols = tableColCount(lines)
  if (cols <= 2) return null
  return lines.map((line) => {
    const cells = tableCells(line)
    cells.pop()
    return joinCells(cells)
  })
}
