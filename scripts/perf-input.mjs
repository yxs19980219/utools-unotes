#!/usr/bin/env node
/**
 * 性能实测：真实 Chromium（系统 Edge/Chrome）测量编辑器输入延迟基线。
 * 运行：npm run dev（另开终端）→ node scripts/perf-input.mjs
 *
 * 方法：
 * - 进入笔记编辑态 → 通过 CM6 内部引用（.cm-content.cmView.view）dispatch 注入大文档
 * - contentDOM keydown 记 t0，两次 rAF 后记 t1 → 每键端到端渲染延迟
 * - PerformanceObserver 收集 longtask（>50ms 主线程阻塞）作为卡顿证据
 * - 同时采样「装饰 DOM 更新量」（每次输入后 .sn-md-* 节点变更计数）反映重建规模
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EDGE_CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const executablePath = EDGE_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('未找到系统 Edge/Chrome，请设置 BROWSER_PATH 环境变量')
  process.exit(1)
}
const base = process.env.UI_SMOKE_BASE ?? 'http://localhost:5173/'
const DOC_LINES = Number(process.env.DOC_LINES ?? 1000)

/** 生成与 bench 同构的混合结构 markdown */
function genDoc(lines) {
  const pool = [
    '# 一级标题：注意力机制',
    '## 二级标题：QKV 变换',
    '### 三级标题：多头拆分',
    '',
    '正文段落，包含 **加粗重点** 与 *斜体术语* 与 `inline code` 与 [链接](https://a.b)。',
    '',
    '- 无序列表项一',
    '  - 嵌套列表项 A',
    '- [x] 已完成任务项',
    '- [ ] 待办任务项',
    '1. 有序列表项一',
    '',
    '> 引用块第一行：**粗体** 与 *斜体*',
    '',
    '---',
    '',
    '```ts',
    'const map = new Map<string, number>()',
    '```',
    '',
    '| 列A | 列B | 列C |',
    '| --- | --- | --- |',
    '| 值1 | 值2 | **值3** |',
    '| 值4 | 值5 | 值6 |',
    '',
  ]
  const out = []
  let i = 0
  while (out.length < lines) {
    out.push(pool[i % pool.length])
    i += 1
  }
  return out.slice(0, lines).join('\n')
}

const browser = await chromium.launch({ executablePath, headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(base, { waitUntil: 'networkidle' })
  // 等 bootstrap 完成（侧边栏「新建对象」入口出现）
  await page.getByRole('button', { name: '新建对象' }).first().waitFor({ timeout: 10000 })

  // 走 UI 流程：新建对象 → 新笔记 → 打开编辑态
  await page.getByRole('button', { name: '新建对象' }).first().click()
  await page.getByLabel('标题').fill('性能测试对象')
  await page.getByRole('button', { name: '创建' }).click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('性能测试笔记')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByText('性能测试笔记').first().click()

  // 等编辑器挂载
  await page.locator('.cm-content').waitFor()
  await page.waitForTimeout(300)

  // 注入大文档（绕过 React 受控，直接 dispatch 到 EditorView）
  const doc = genDoc(DOC_LINES)
  await page.evaluate(async (text) => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js')
    const view = EditorView.findFromDOM(document.querySelector('.cm-content'))
    if (!view) throw new Error('no view')
    window.__view = view
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  }, doc)
  await page.waitForTimeout(500)

  // 打点：keydown → 两帧后 = 该键渲染完成；MutationObserver 统计每键 DOM 变更量
  await page.evaluate(() => {
    const cm = document.querySelector('.cm-content')
    const samples = (window.__perf = { samples: [], longTasks: [], domChanges: [] })
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) samples.longTasks.push(Math.round(e.duration))
    })
    obs.observe({ entryTypes: ['longtask'] })
    let pending = 0
    const mo = new MutationObserver((muts) => {
      pending += muts.length
    })
    mo.observe(cm, { childList: true, subtree: true, characterData: true, attributes: true })
    const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    window.__tick = async () => {
      const t0 = performance.now()
      await raf2()
      samples.samples.push(performance.now() - t0)
      samples.domChanges.push(pending)
      pending = 0
    }
  })

  // 在文档中部连续输入 30 键（每键等一帧，测端到端延迟）
  // 先点进编辑器中部
  await page.evaluate(async () => {
    const { EditorView } = await import('/node_modules/.vite/deps/@codemirror_view.js')
    const view = EditorView.findFromDOM(document.querySelector('.cm-content'))
    const half = Math.floor(view.state.doc.lines / 2)
    const pos = view.state.doc.line(half).from + 2
    view.dispatch({ selection: { anchor: pos } })
    document.querySelector('.cm-content').focus()
  })
  await page.waitForTimeout(200)

  const t0 = Date.now()
  for (let i = 0; i < 30; i++) {
    await page.keyboard.type('a', { delay: 0 })
    await page.evaluate(() => window.__tick())
  }
  const wallMs = Date.now() - t0

  const perf = await page.evaluate(() => window.__perf)
  const samples = perf.samples.slice(1) // 去首键预热
  const domChanges = perf.domChanges.slice(1)
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length
  const p95 = [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)]
  const domAvg = domChanges.reduce((a, b) => a + b, 0) / domChanges.length
  console.log(`文档 ${DOC_LINES} 行 × 30 键（壁钟 ${wallMs}ms，含事件开销）`)
  console.log(`每键 端到端渲染延迟：avg ${avg.toFixed(1)}ms  p95 ${p95.toFixed(1)}ms  max ${Math.max(...samples).toFixed(1)}ms`)
  console.log(`每键 DOM 变更量：avg ${domAvg.toFixed(1)} 次  max ${Math.max(...domChanges)} 次`)
  console.log(`longtask（>50ms 主线程阻塞）：${perf.longTasks.length} 次 ${JSON.stringify(perf.longTasks.slice(0, 10))}`)
  const ratio = samples.filter((s) => s > 33).length / samples.length
  console.log(`超过 2 帧（33ms）的按键占比：${(ratio * 100).toFixed(0)}%`)
} finally {
  await browser.close()
}
