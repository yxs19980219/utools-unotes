/**
 * scripts/bench-decorations.ts —— 装饰构建性能基准（headless，无 DOM 依赖）
 * 运行：node scripts/bench-decorations.ts
 * 对比重构前后 buildDecorations 耗时，验收阈值（PRD）：
 *   500 行 < 2ms、5000 行 < 10ms，或相对优化前提升 ≥ 5 倍
 */
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { buildDecorations } from '../src/components/Editor/markdownDecorations.ts'

/** 语法树驱动装饰依赖 language 扩展（与编辑器运行时一致） */
const LANG_EXT = [markdown({ extensions: [GFM] })]

/** 生成混合结构 markdown（标题/列表/任务/引用/围栏/表格/行内语法混排） */
function genDoc(lines: number): string {
  const pool = [
    '# 一级标题：注意力机制',
    '## 二级标题：QKV 变换',
    '### 三级标题：多头拆分',
    '',
    '正文段落，包含 **加粗重点** 与 *斜体术语* 与 `inline code` 与 [链接](https://a.b)。',
    '第二行正文，包含 ~~删除线~~ 与 ==高亮== 与 $公式$ 混排。',
    '',
    '- 无序列表项一',
    '  - 嵌套列表项 A',
    '    - 二级嵌套 B',
    '- [x] 已完成任务项',
    '- [ ] 待办任务项',
    '1. 有序列表项一',
    '2. 有序列表项二',
    '',
    '> 引用块第一行',
    '> 引用块第二行：**粗体** 与 *斜体*',
    '',
    '---',
    '',
    '```ts',
    'const map = new Map<string, number>()',
    'function add(a: number, b: number) { return a + b }',
    '```',
    '',
    '| 列A | 列B | 列C |',
    '| --- | --- | --- |',
    '| 值1 | 值2 | **值3** |',
    '| 值4 | 值5 | 值6 |',
    '',
  ]
  const out: string[] = []
  let i = 0
  while (out.length < lines) {
    out.push(pool[i % pool.length])
    i += 1
  }
  return out.slice(0, lines).join('\n')
}

/** 光标在文档中部（第 40% 行），贴近真实编辑位置 */
function bench(lines: number, iterations: number): { ms: number; msPerOp: number } {
  const doc = genDoc(lines)
  const state = EditorState.create({
    doc,
    selection: { anchor: stateFromLine(doc, Math.floor(lines * 0.4)) },
    extensions: LANG_EXT,
  })
  // 预热
  for (let i = 0; i < 3; i++) buildDecorations(state)
  const t0 = performance.now()
  for (let i = 0; i < iterations; i++) buildDecorations(state)
  const ms = performance.now() - t0
  return { ms, msPerOp: ms / iterations }
}

/** 文档第 n 行（1-based）起始偏移 */
function stateFromLine(doc: string, n: number): number {
  const lines = doc.split('\n')
  let pos = 0
  for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1
  return Math.min(pos, doc.length - 1)
}

function main() {
  console.log('=== buildDecorations 性能基准 ===\n')
  const cases: [number, number][] = [
    [500, 200],
    [2000, 50],
    [5000, 20],
  ]
  const results: { lines: number; msPerOp: number }[] = []
  for (const [lines, iters] of cases) {
    const { msPerOp } = bench(lines, iters)
    results.push({ lines, msPerOp })
    console.log(`  ${String(lines).padStart(5)} 行: ${msPerOp.toFixed(3)} ms/次 (${iters} 次均值)`)
  }
  console.log('\n验收阈值：500 行 < 2ms、5000 行 < 10ms 或相对优化前提升 ≥ 5 倍')
  const baseline = results[0]?.msPerOp ?? 0
  if (baseline > 2) {
    console.log(`\n⚠️ 500 行 ${baseline.toFixed(3)}ms 超出 2ms 阈值 —— 需要优化`)
  } else {
    console.log('\n✅ 500 行在阈值内')
  }
}

main()
