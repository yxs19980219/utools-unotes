/**
 * scripts/smoke-tableModel.ts —— GFM Markdown 表格模型冒烟（headless）
 * 运行：node scripts/smoke-tableModel.ts
 */
import assert from 'node:assert/strict'
import {
  getTableCell,
  parseMarkdownTable,
  parseTableRowCells,
  serializeMarkdownTable,
} from '../src/lib/markdownTableModel.ts'
import { addTableRow, joinCells, tableCells } from '../src/lib/tableOps.ts'

let passed = 0
function ok(name: string) {
  passed += 1
  console.log(`  ✔ ${name}`)
}

const tableText = [
  '| 列A | 列B |',
  '| :--- | ---: |',
  '| A\\|B | 内容 |',
  '|  | 尾部 |',
].join('\n')

// 1. 标准表格 + 绝对范围
{
  const model = parseMarkdownTable(tableText, 10)
  assert.ok(model)
  assert.equal(model.from, 10)
  assert.equal(model.to, 10 + tableText.length)
  assert.equal(model.columnCount, 2)
  assert.equal(model.rows.length, 4)
  assert.equal(model.header.cells[0].text, '列A')
  assert.equal(model.header.cells[0].from, 11)
  assert.equal(model.body[0].cells[0].text, 'A|B')
  assert.equal(model.body[0].cells[0].contentFrom < model.body[0].cells[0].contentTo, true)
  assert.deepEqual(model.alignments, ['left', 'right'])
  ok('标准表格：解析列数、对齐和绝对源码范围')
}

// 2. 转义管道符与单元格范围
{
  const cells = parseTableRowCells('| A\\|B | C |')
  assert.equal(cells.length, 2)
  assert.equal(cells[0].text, 'A|B')
  assert.equal(tableCells('| A\\|B | C |')[0], 'A|B')
  const model = parseMarkdownTable(tableText)!
  assert.equal(getTableCell(model, 'body', 0, 0)?.text, 'A|B')
  ok('单元格：\\| 作为内容管道符，不被误判为列分隔符')
}

// 3. 稳定序列化：规范化空格、转义和不规则行补空单元格
{
  const ragged = parseMarkdownTable(
    '| H1 | H2 | H3 |\n| --- | --- | --- |\n| A | B |',
  )!
  assert.equal(ragged.body[0].cells.length, 2)
  assert.equal(
    serializeMarkdownTable(ragged),
    '| H1 | H2 | H3 |\n| --- | --- | --- |\n| A | B |  |',
  )
  assert.equal(
    serializeMarkdownTable(parseMarkdownTable(tableText)!),
    tableText,
  )
  ok('序列化：转义、对齐和不规则数据行可稳定 round-trip')
}

// 4. 非法/半成品表格保留源码，不生成模型
{
  assert.equal(parseMarkdownTable('| A | B |'), null, '缺少分隔行')
  assert.equal(parseMarkdownTable('| A | B |\n| nope | nope |'), null, '分隔行非法')
  assert.equal(parseMarkdownTable('普通文本 | 不是表格'), null, '非表格文本')
  assert.equal(parseMarkdownTable('| A | B |\n\n| x | y |'), null, '表格中间有空行')
  ok('半成品/非法输入：不生成表格模型')
}

// 5. 旧表格操作继续复用模型的转义规则
{
  const lines = ['| A | B |', '| --- | --- |', '| a\\|b | c |']
  assert.deepEqual(addTableRow(lines), [
    '| A | B |',
    '| --- | --- |',
    '| a\\|b | c |',
    '| 内容 | 内容 |',
  ])
  assert.equal(joinCells(['a|b', 'c']), '| a\\|b | c |')
  ok('结构操作：旧 tableOps 保持 API，并正确转义写回内容')
}

console.log(`\n全部通过：${passed} 项断言`)
