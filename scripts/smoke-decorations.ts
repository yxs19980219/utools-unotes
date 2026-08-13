/**
 * 阶段 5a 装饰器冒烟测试（headless，无 DOM 依赖）
 * 运行：node scripts/smoke-decorations.ts
 * 覆盖：标题（光标行淡色标记 / 非光标行隐藏）/ 粗体 / 斜体 / 行内代码 / 链接 /
 *       任务复选框 Widget / 引用 / 分隔线 / 代码块围栏 / 普通列表标记
 */
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { Decoration, DecorationSet } from '@codemirror/view'
import { buildDecorations } from '../src/components/Editor/markdownDecorations.ts'

/** 语法树驱动装饰依赖 language 扩展：state 需挂 markdown+GFM（与编辑器运行时一致） */
const LANG_EXT = [markdown({ extensions: [GFM] })]

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
  const state = EditorState.create({ doc, selection: { anchor: 1 }, extensions: LANG_EXT })
  const set = buildDecorations(state)
  const items = collect(set)

  const lineAt = (n: number) => state.doc.line(n)

  // 1. 标题：光标行标记淡色，非光标行隐藏；内容行有对应级别样式
  {
    const l1 = lineAt(1)
    // 语法树版：HeaderMark 仅覆盖 # 本身（不含后续空白）；光标行标记带级别字号类（需求 12）
    const l1Marker = items.filter((i) => i.from === 0 && i.to === 1)
    assert.equal(l1Marker.length, 1, 'h1 标记范围 [0,1)')
    assert.equal(l1Marker[0].cls, 'sn-md-h1-mark', '光标行标题标记 → 级别字号类（淡色）')
    const l1Content = items.filter((i) => i.from === 1 && i.to === l1.to)
    assert.equal(l1Content[0].cls, 'sn-md-h1', 'h1 内容行样式')

    const l2 = lineAt(2)
    const l2Marker = items.filter((i) => i.from === l2.from && i.to === l2.from + 2)
    assert.equal(l2Marker[0].cls, 'sn-md-hidden', '非光标行标题标记 → 隐藏')
    const l2Content = items.filter((i) => i.from === l2.from + 2 && i.to === l2.to)
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
    const state2 = EditorState.create({ doc, selection: { anchor: lineAt(4).from + 2 }, extensions: LANG_EXT })
    const set2 = buildDecorations(state2)
    const items2 = collect(set2)
    assert.equal(
      items2.find((i) => i.from === 0 && i.to === 1)?.cls,
      'sn-md-hidden',
      '光标离开标题行 → h1 标记隐藏',
    )
    ok('光标行机制：光标移动后标题标记切换 显示/隐藏')
  }

  // 8. GFM 表格（R10）：表头加粗 + 首行上边框 + 末行下边框 + 分隔符淡色
  {
    const tableDoc = [
      '| 列A | 列B |',
      '| --- | --- |',
      '| 值1 | 值2 |',
      '| 值3 | **值4** |',
    ].join('\n')
    const state3 = EditorState.create({ doc: tableDoc, selection: { anchor: 0 }, extensions: LANG_EXT })
    const set3 = buildDecorations(state3)
    const items3 = collect(set3)
    const t = (n: number) => state3.doc.line(n)

    const headCls = items3.filter((i) => i.from === t(1).from && i.to === t(1).to)
    assert.equal(
      headCls.some((i) => i.cls.includes('sn-md-tbl-head')),
      true,
      '表头行加粗样式',
    )
    assert.equal(
      headCls.some((i) => i.cls.includes('sn-md-tbl-first')),
      true,
      '表首行上边框',
    )
    const sepCls = items3.filter((i) => i.from === t(2).from && i.to === t(2).to)
    assert.equal(sepCls.some((i) => i.cls.includes('sn-md-tbl-sep')), true, '分隔行淡色')
    const lastCls = items3.filter((i) => i.from === t(4).from && i.to === t(4).to)
    assert.equal(
      lastCls.some((i) => i.cls.includes('sn-md-tbl-last')),
      true,
      '末行下边框',
    )
    // 分隔符 | 淡色（表头行内所有 | 位置）
    const headText = t(1).text
    let idx = headText.indexOf('|')
    let pipeDim = 0
    while (idx !== -1) {
      if (clsAt(items3, t(1).from + idx).includes('sn-md-dim')) pipeDim += 1
      idx = headText.indexOf('|', idx + 1)
    }
    assert.equal(pipeDim, 3, '表头行 3 个 | 分隔符全部淡色')
    // 单元格内粗体不做行内扫描（MVP 折中：整行表格样式，无 bold 类）
    const boldRow = t(4).text
    const boldPos = t(4).from + boldRow.indexOf('**值4**') + 2
    assert.equal(clsAt(items3, boldPos).includes('sn-md-bold'), false, '单元格内不做行内扫描')
    ok('表格：表头加粗/边框/分隔符淡色（R10）')
  }

  // 9. 嵌套列表（需求 13/14）：符号随深度变化 •/◦/▪ + 缩进 spacer 随深度递增
  {
    const nestedDoc = ['- 一级项', '  - 二级项', '    - 三级项', '      - 四级项'].join('\n')
    const state4 = EditorState.create({ doc: nestedDoc, selection: { anchor: 0 }, extensions: LANG_EXT })
    const set4 = buildDecorations(state4)
    const items4 = collect(set4)
    // 符号 Widget：按深度取符号文本（node 直跑 TS，class 名保留）
    const widgets = items4
      .filter((i) => i.widget !== null)
      .map((i) => ({
        from: i.from,
        depth: (i.widget as { depth?: number } | null)?.depth,
        kind: i.widget?.constructor.name,
      }))
    const bullets = widgets.filter((w) => w.kind === 'BulletWidget')
    assert.deepEqual(
      bullets.map((b) => b.depth),
      [1, 2, 3, 4],
      '四个嵌套层级各有 BulletWidget，深度 1/2/3/4',
    )
    const indents = widgets.filter((w) => w.kind === 'ListIndentWidget')
    assert.deepEqual(
      indents.map((i) => i.depth),
      [1, 2, 3],
      '二级起每行有缩进 spacer（一级无），深度 1/2/3',
    )
    // 符号字符映射：depth 1 → • / 2 → ◦ / 3+ → ▪（toDOM 需 DOM，depth 断言即可）
    ok('嵌套列表：符号深度 1/2/3/4 + 缩进 spacer 深度 1/2/3（需求 13/14）')
  }

  // 10. 图片（需求 9）：完整 Image 节点 → img widget 替换；半成品回退链接样式
  {
    const imgDoc = '![示例图](https://a.b/c.png) 与 ![半成品]('
    const state5 = EditorState.create({ doc: imgDoc, selection: { anchor: 0 }, extensions: LANG_EXT })
    const set5 = buildDecorations(state5)
    const items5 = collect(set5)
    const imgWidget = items5.find((i) => i.widget !== null)
    assert.ok(imgWidget, '完整图片有 widget')
    assert.equal(imgWidget.widget?.constructor.name, 'ImageWidget', 'widget 类型')
    assert.equal(imgWidget.from, 0, '替换整个图片语法')
    // 半成品（无 URL）：无 widget，按链接样式（LinkMark dim）
    const halfItems = items5.filter((i) => i.widget !== null)
    assert.equal(halfItems.length, 1, '半成品图片不渲染 widget')
    ok('图片：完整语法 → ImageWidget 替换 / 半成品回退（需求 9）')
  }

  console.log(`\n全部通过：${passed} 项断言`)
}

main()
