/**
 * 阶段 5a 装饰器冒烟测试（headless，无 DOM 依赖）
 * 运行：node scripts/smoke-decorations.ts
 * 覆盖：标题（光标行淡色标记 / 非光标行隐藏）/ 粗体 / 斜体 / 行内代码 / 链接 /
 *       任务复选框 Widget / 引用 / 分隔线 / 代码块围栏 / 普通列表标记
 */
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import type { Decoration, DecorationSet } from '@codemirror/view'
import { buildDecorations } from '../src/components/Editor/markdownDecorations.ts'

let passed = 0
function ok(name: string) {
  passed += 1
  console.log(`  ✔ ${name}`)
}

/** 收集 (from, to, class, widget?) 元组 */
function collect(set: DecorationSet) {
  const items: { from: number; to: number; cls: string; widget: unknown }[] = []
  set.between(0, 1e9, (from, to, deco: Decoration) => {
    items.push({ from, to, cls: deco.spec.class ?? '', widget: deco.spec.widget ?? null })
  })
  return items
}

function clsAt(items: ReturnType<typeof collect>, pos: number): string[] {
  return items.filter((i) => i.from <= pos && pos < i.to).map((i) => i.cls)
}

function main() {
  const doc = [
    '# 注意力机制',
    '## 子标题',
    '',
    '正文 **加粗** 与 *斜体* 与 `行内代码` 与 [链接](https://a.b)',
    '',
    '- 列表项一',
    '- [x] 已完成任务',
    '- [ ] 待办任务',
    '1. 有序项一',
    '',
    '> 引用内容',
    '',
    '---',
    '',
    '```js',
    'const a = 1',
    '```',
    '',
  ].join('\n')

  // 光标放在第 1 行（# 注意力机制）
  const state = EditorState.create({ doc, selection: { anchor: 1 } })
  const set = buildDecorations(state)
  const items = collect(set)

  const lineAt = (n: number) => state.doc.line(n)

  // 1. 标题：光标行标记淡色，非光标行隐藏；内容行有对应级别样式
  {
    const l1 = lineAt(1)
    const l1Marker = items.filter((i) => i.from === 0 && i.to === 2)
    assert.equal(l1Marker.length, 1, 'h1 标记范围 [0,2)')
    assert.equal(l1Marker[0].cls, 'sn-md-dim', '光标行标题标记 → 淡色')
    const l1Content = items.filter((i) => i.from === 2 && i.to === l1.to)
    assert.equal(l1Content[0].cls, 'sn-md-h1', 'h1 内容行样式')

    const l2 = lineAt(2)
    const l2Marker = items.filter((i) => i.from === l2.from && i.to === l2.from + 3)
    assert.equal(l2Marker[0].cls, 'sn-md-hidden', '非光标行标题标记 → 隐藏')
    const l2Content = items.filter((i) => i.from === l2.from + 3 && i.to === l2.to)
    assert.equal(l2Content[0].cls, 'sn-md-h2', 'h2 内容行样式')
    ok('标题：光标行淡色标记 / 非光标行隐藏 + 级别样式')
  }

  // 2. 粗体/斜体/行内代码/链接
  {
    const l4 = lineAt(4)
    const seg = l4.text
    const base = l4.from
    const boldStart = seg.indexOf('**加粗**')
    assert.equal(clsAt(items, base + boldStart).includes('sn-md-dim'), true, '粗体起始标记淡色')
    assert.equal(clsAt(items, base + boldStart + 2).includes('sn-md-bold'), true, '粗体内容')
    const italicStart = seg.indexOf('*斜体*')
    assert.equal(clsAt(items, base + italicStart + 1).includes('sn-md-italic'), true, '斜体内容')
    const codeStart = seg.indexOf('`行内代码`')
    assert.equal(clsAt(items, base + codeStart).includes('sn-md-dim'), true, '行内码起始反引号淡色')
    assert.equal(clsAt(items, base + codeStart + 1).includes('sn-md-code'), true, '行内码内容')
    const linkStart = seg.indexOf('[链接](https://a.b)')
    assert.equal(clsAt(items, base + linkStart).includes('sn-md-dim'), true, '链接 [ 淡色')
    assert.equal(clsAt(items, base + linkStart + 1).includes('sn-md-link'), true, '链接文本样式')
    assert.equal(clsAt(items, base + linkStart + 3 + 6).includes('sn-md-dim'), true, '链接 ](url) 淡色')
    ok('行内：粗体/斜体/行内代码/链接，标记淡色 + 内容样式')
  }

  // 3. 列表标记 + 任务复选框 Widget
  {
    const l6 = lineAt(6)
    // 无序列表：标记替换为 • Widget（源文本不变，仅显示替换）
    assert.equal(
      items.some((i) => i.from === l6.from && i.to === l6.from + 2 && i.widget !== null),
      true,
      '无序列表标记替换为 • Widget',
    )
    // 有序列表：标记保持淡色（数字不替换）
    const l6b = lineAt(9)
    assert.equal(clsAt(items, l6b.from).includes('sn-md-dim'), true, '有序列表标记淡色')
    const l7 = lineAt(7)
    const boxFrom = l7.from + 2 // '- ' 后
    const boxItems = items.filter((i) => i.from === boxFrom && i.to === boxFrom + 3)
    assert.equal(boxItems.length, 1, '[x] 被替换装饰覆盖')
    assert.equal(boxItems[0].widget !== null, true, '任务框为 Widget 替换')
    const l8 = lineAt(8)
    assert.equal(
      items.some((i) => i.from === l8.from + 2 && i.widget !== null),
      true,
      '[ ] 待办也有 Widget',
    )
    ok('列表：标记淡色 + [x]/[ ] 复选框 Widget')
  }

  // 4. 引用：> 淡色 + 整行边框样式
  {
    const l10 = lineAt(11)
    assert.equal(clsAt(items, l10.from).includes('sn-md-dim'), true, '引用 > 淡色')
    const whole = items.filter((i) => i.from === l10.from && i.to === l10.to)
    assert.equal(whole.some((i) => i.cls === 'sn-md-quote'), true, '引用整行边框样式')
    ok('引用：> 淡色 + 整行边框')
  }

  // 5. 分隔线：整行 hr 样式
  {
    const l12 = lineAt(13)
    const hr = items.filter((i) => i.from === l12.from && i.to === l12.to)
    assert.equal(hr.some((i) => i.cls === 'sn-md-hr'), true, '--- 整行 hr 样式')
    ok('分隔线：--- 渲染为水平线')
  }

  // 6. 围栏代码块：围栏行淡色 + 内部等宽背景
  {
    const l14 = lineAt(15)
    assert.equal(clsAt(items, l14.from).includes('sn-md-fence'), true, '开围栏行淡色')
    const l15 = lineAt(16)
    assert.equal(clsAt(items, l15.from).includes('sn-md-codeblock'), true, '代码内容行样式')
    const l16 = lineAt(17)
    assert.equal(clsAt(items, l16.from).includes('sn-md-fence'), true, '闭围栏行淡色')
    ok('代码块：围栏行淡色 + 内容行等宽背景')
  }

  // 7. 光标移到非标题行：所有标题标记隐藏（光标行机制重算）
  {
    const state2 = EditorState.create({ doc, selection: { anchor: lineAt(4).from + 2 } })
    const set2 = buildDecorations(state2)
    const items2 = collect(set2)
    assert.equal(
      items2.find((i) => i.from === 0 && i.to === 2)?.cls,
      'sn-md-hidden',
      '光标离开标题行 → h1 标记隐藏',
    )
    ok('光标行机制：光标移动后标题标记切换 显示/隐藏')
  }

  console.log(`\n全部通过：${passed} 项断言`)
}

main()
