/**
 * scripts/smoke-tableOps.ts —— 表格操作纯函数冒烟（headless）
 * 运行：node scripts/smoke-tableOps.ts
 */
import assert from 'node:assert/strict'
import {
  addTableCol,
  addTableRow,
  removeTableCol,
  removeTableRow,
  tableCells,
  tableColCount,
} from '../src/lib/tableOps.ts'

let passed = 0
function ok(name: string) {
  passed += 1
  console.log(`  ✔ ${name}`)
}

const T3 = ['| 列A | 列B | 列C |', '| --- | --- | --- |', '| 值1 | 值2 | 值3 |']

// 1. 列数
{
  assert.equal(tableColCount(T3), 3, '3 列表格')
  assert.equal(tableColCount(['| a | b |']), 0, '无分隔行 → 0')
  ok('列数：3 列 / 无分隔行 0')
}

// 2. 加行：末尾追加对齐列数的数据行
{
  const r = addTableRow(T3)!
  assert.deepEqual(r, [
    '| 列A | 列B | 列C |',
    '| --- | --- | --- |',
    '| 值1 | 值2 | 值3 |',
    '| 内容 | 内容 | 内容 |',
  ])
  ok('加行：追加 3 列数据行')
}

// 3. 删行：指定数据行；仅剩 1 行拒绝
{
  const T2 = [...T3, '| 值4 | 值5 | 值6 |']
  const r = removeTableRow(T2, 0)!
  assert.deepEqual(r, ['| 列A | 列B | 列C |', '| --- | --- | --- |', '| 值4 | 值5 | 值6 |'])
  assert.equal(removeTableRow(T2, 5), null, '越界拒绝')
  assert.equal(removeTableRow(T3, 0), null, '仅剩 1 行拒绝')
  ok('删行：删数据行 / 越界与仅剩 1 行拒绝')
}

// 4. 加列：表头/分隔行/数据行各追加
{
  const r = addTableCol(T3)!
  assert.deepEqual(r, [
    '| 列A | 列B | 列C | 新列4 |',
    '| --- | --- | --- | --- |',
    '| 值1 | 值2 | 值3 | 内容 |',
  ])
  assert.equal(tableColCount(r), 4, '加列后 4 列')
  ok('加列：各行列追加 + 新列名递增')
}

// 5. 删列：移除末列；列数 ≤ 2 拒绝
{
  const r = removeTableCol(addTableCol(T3)!)!
  assert.deepEqual(r, T3, '删列还原 3 列')
  assert.equal(removeTableCol(['| a | b |', '| - | - |', '| 1 | 2 |']), null, '2 列拒绝删列')
  ok('删列：移除末列 / 2 列拒绝')
}

// 6. 单元格内容含管道符：trim 保留文本（MVP 不处理转义）
{
  assert.deepEqual(tableCells('| a | b | c |'), ['a', 'b', 'c'])
  ok('单元格解析：trim')
}

console.log(`\n全部通过：${passed} 项断言`)
