/**
 * scripts/smoke-outline.ts —— 大纲解析/字数纯函数冒烟（headless）
 * 运行：node scripts/smoke-outline.ts
 */
import assert from 'node:assert/strict'
import { countChars, parseOutline } from '../src/lib/outline.ts'

let passed = 0
function ok(name: string) {
  passed += 1
  console.log(`  ✔ ${name}`)
}

// 1. 大纲解析：级别/文本/偏移（跳过 # 后无空白的伪标题）
{
  const items = parseOutline('# 标题一\n正文\n## 标题二 **粗**\n### 三\n#无空格非标题\n#### 四\n')
  assert.deepEqual(
    items.map((i) => [i.level, i.text]),
    [[1, '标题一'], [2, '标题二 **粗**'], [3, '三'], [4, '四']],
    '级别与文本',
  )
  assert.deepEqual(items.map((i) => i.offset), [0, 9, 22, 36], '偏移（供 jumpTo）')
  ok('大纲：1-4 级解析 + 偏移 + 跳过伪标题')
}

// 2. 无标题文档 → 空大纲
{
  assert.equal(parseOutline('普通文本\n- 列表项').length, 0, '无标题空大纲')
  ok('大纲：无标题返回空数组')
}

// 3. 字数：trim 后按字符计
{
  assert.equal(countChars('  abc 中文  '), 6, 'trim 后 6 字符')
  assert.equal(countChars(''), 0, '空正文 0')
  ok('字数：trim 后字符计数')
}

console.log(`\n全部通过：${passed} 项断言`)
