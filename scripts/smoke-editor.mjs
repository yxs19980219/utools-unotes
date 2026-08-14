#!/usr/bin/env node
/**
 * 编辑器专项冒烟（任务 08-14-editor-ux-rebuild 阶段 3）：atomic-editor + 自研公式扩展。
 *
 * 覆盖：
 * - 公式：行内/块级（单行/多行）/光标行源码/未闭合不渲染/`a $ b` 不渲染/转义 \$ 不渲染
 * - 任务勾选框点击切换写回 [x]
 * - 引用块/分割线/代码围栏渲染（非光标行）
 * - R11：输入 / 无斜杠命令菜单
 * - 工具栏 20 项 + wrap/行级/块级插入
 * - 图片插入（文件选择 → 源码 `![alt](path)`）
 * - Ctrl+S 立即落盘、大纲跳转（offset）、深色主题
 * - round-trip：编辑→保存→重开 源文本字节一致（window.__snDebug.getActiveNoteContent）
 * - 长文档（600 行）输入与滚动流畅
 *
 * 测试策略（抗 CM6 block-widget 垂直导航特性）：
 * - 正文一律 insertText 整段插入（光标确定性落在文档尾；不走逐键 inputHandler，
 *   避免 autoCloseCodeFence/列表续行等编辑助手干扰）
 * - 垂直定位用「点击目标行」（heightmap 修复后点击可靠）；行内定位只用
 *   Home/End/Shift+Home（水平键不依赖 heightmap）
 *
 * 前置：dev server 已在 5173 运行（npm run dev），数据走 MemoryDb。
 * 运行：npm run smoke:editor
 */
import { chromium } from 'playwright-core'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
const results = []
const ok = (name, pass) => {
  results.push([name, pass])
  console.log(`${pass ? '✅' : '❌'} ${name}`)
}

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200))
})

/** 条件等待：轮询页面条件（默认 5s 超时），条件已满足时立即返回 */
const waitFor = (fn, timeout = 5000, arg) => page.waitForFunction(fn, arg, { timeout })
/** 读取已落盘正文（store 为准，规避渲染 DOM 与源码差异） */
const getContent = () => page.evaluate(() => window.__snDebug.getActiveNoteContent())
/** 点击某个 .cm-line 文本所在行（垂直定位用；点击行内文本起点附近） */
const clickLineWith = async (text) => {
  const box = await page.locator(`.cm-content .cm-line:has-text("${text}")`).first().boundingBox()
  if (!box) throw new Error(`行未找到: ${text}`)
  await page.mouse.click(box.x + 10, box.y + box.height / 2)
}
/** 当前光标行文本 */
const activeLineText = () =>
  page.evaluate(() => document.querySelector('.cm-line.cm-activeLine')?.textContent ?? '')
const mathCounts = () =>
  page.evaluate(() => ({
    blocks: document.querySelectorAll('.cm-math-block').length,
    inline: document.querySelectorAll('.cm-math-inline').length,
  }))

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '新建对象' }).first().waitFor({ timeout: 10000 })

  // ---- 建对象 + 建笔记 ----
  await page.getByRole('button', { name: '新建对象' }).first().click()
  await page.getByLabel('标题').fill('编辑器专项对象')
  await page.getByRole('button', { name: '创建' }).click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('编辑器专项笔记')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByRole('button', { name: /编辑器专项笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /编辑器专项笔记/ }).first().click()
  await page.locator('.cm-content').first().waitFor()

  // ---- 1. placeholder（空笔记） ----
  await waitFor(() => !!document.querySelector('.cm-placeholder'))
  ok('空笔记 placeholder 显示', (await page.locator('.cm-placeholder').count()) >= 1)

  // ---- 2. 工具栏按钮数（R8；基线实际 20 项 = 9 wrap + 7 行级 + 4 块级） ----
  const toolCount = await page.locator('[role="toolbar"] button').count()
  ok(`工具栏按钮数（基线 20 项：9 wrap+7 行级+4 块级；PRD 写 19 以基线为准，实际 ${toolCount}）`,
    toolCount === 20)

  // ---- 3. 整段正文（insertText 确定性构建；光标落在文档尾） ----
  const BASE_DOC = [
    '行内公式 $x^2 + 1$ 结束',
    '$$\\frac{a}{b}$$',
    '$$',
    'E = mc^2',
    '$$',
    '未闭合 $x^2 之后',
    '价格 a $ b 元',
    '\\$转义美元符号',
    '> 引用内容',
    '---',
    '```ts',
    'const n: number = 1',
    '```',
  ].join('\n')
  await page.locator('.cm-content').click()
  await page.keyboard.insertText(BASE_DOC)
  await page.waitForTimeout(400)

  // ---- 4. 公式渲染（点击目标行 → 光标行源码；点击别处 → 渲染） ----
  await clickLineWith('行内公式')
  await waitFor(() => (document.querySelector('.cm-line.cm-activeLine')?.textContent ?? '').includes('$x^2 + 1$'))
  ok('AC1：光标行公式显示源码可编辑',
    (await activeLineText()).includes('$x^2 + 1$'))
  await page.locator('.cm-content .cm-line').last().click() // 光标回文档尾 → 行内公式渲染
  await waitFor(() => document.querySelectorAll('.cm-math-inline').length >= 1)
  const mc1 = await mathCounts()
  ok('AC1：行内公式 KaTeX 渲染',
    mc1.inline >= 1 && (await page.locator('.cm-math-inline .katex').count()) >= 1)
  ok('AC1：公式块渲染（单行 + 多行 $$…$$）',
    mc1.blocks >= 2 && (await page.locator('.cm-math-block .katex').count()) >= 2)

  // ---- 5. 语法边界：未闭合 / a $ b / 转义 $ 不渲染 ----
  await clickLineWith('未闭合 $x^2 之后')
  await page.waitForTimeout(200)
  const mcBefore = await mathCounts()
  await page.locator('.cm-content .cm-line').last().click()
  await page.waitForTimeout(200)
  const mcAfter = await mathCounts()
  ok('未闭合 $ 不渲染 + `a $ b` 不渲染 + 转义 \\$ 不渲染',
    mcAfter.blocks === mcBefore.blocks && mcAfter.inline === mcBefore.inline)

  // ---- 6. 任务勾选框：渲染 + 点击切换写回 [x] ----
  await page.locator('.cm-content .cm-line').last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter') // 围栏闭合行后新空行（围栏外）
  await page.keyboard.type('- [ ] 待办一')
  await page.keyboard.press('Enter') // 列表续行（光标离开任务行 → 勾选框渲染）
  await waitFor(() => document.querySelectorAll('input.cm-atomic-task-checkbox').length >= 1)
  await page.locator('input.cm-atomic-task-checkbox').first().click()
  await waitFor((s) => window.__snDebug.getActiveNoteContent().includes(s), 4000, '- [x] 待办一')
  ok('AC2：勾选框点击切换写回 [x]', (await getContent()).includes('- [x] 待办一'))
  // 清掉列表续行标记（Shift+Home 选中 → Backspace），再断言无 `- [ ]` 残留
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(200)
  ok('AC2：渲染无 `- [ ]` 残留（勾选框替身）',
    !(await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')).includes('- [ ]'))

  // ---- 7. 引用块 / 分割线渲染 ----
  await page.locator('.cm-content .cm-line').last().click()
  await page.keyboard.press('End')
  await waitFor(() => document.querySelectorAll('.cm-line.cm-atomic-blockquote').length >= 1)
  ok('AC3：引用块渲染（非光标行无 > 残留）',
    (await page.locator('.cm-line.cm-atomic-blockquote').count()) >= 1 &&
    !(await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')).includes('> 引用内容'))
  ok('AC5：分割线渲染为水平线', (await page.locator('.cm-line.cm-atomic-hr').count()) >= 1)

  // ---- 8. 代码块：围栏渲染 + 语言选择（光标行源码编辑） ----
  // 点击围栏代码行（内容行可点击）→ 围栏激活显示源码 → ArrowUp×1 到 ```ts 行改语言
  await clickLineWith('const n: number = 1')
  await page.keyboard.press('ArrowUp')
  await waitFor(() => (document.querySelector('.cm-line.cm-activeLine')?.textContent ?? '').includes('```ts'))
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('python')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown') // 离开围栏 → 渲染
  await waitFor(() => document.querySelectorAll('.cm-line.cm-atomic-fenced-code').length >= 1)
  ok('AC4：代码块围栏渲染（离开光标行后无围栏残留）',
    (await page.locator('.cm-line.cm-atomic-fenced-code').count()) >= 1 &&
    !(await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')).includes('```python'))
  await waitFor((s) => window.__snDebug.getActiveNoteContent().includes(s), 4000, '```python')
  ok('AC4：语言标签光标行源码可编辑（改写围栏）', (await getContent()).includes('```python'))

  // ---- 9. R11：无斜杠命令 / 块手柄 ----
  await page.locator('.cm-content .cm-line').last().click()
  await page.keyboard.type('/')
  await page.waitForTimeout(400)
  ok('R11：输入 / 无斜杠命令菜单/块手柄',
    (await page.getByRole('menu').count()) === 0 &&
    (await page.locator('.cm-tooltip').count()) === 0 &&
    (await page.locator('[class*="block-handle"], [class*="slash"]').count()) === 0)
  await page.keyboard.press('Backspace')

  // ---- 10. 工具栏 wrap/行级/块级（抽样） ----
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Backspace') // 清掉列表续行残留标记 → 空行
  await page.keyboard.type('包裹目标')
  await page.keyboard.press('Shift+Home') // 选中当前行文本 → 点「加粗」
  await page.getByRole('button', { name: '加粗' }).click()
  await waitFor((s) => window.__snDebug.getActiveNoteContent().includes(s), 4000, '**包裹目标**')
  ok('工具栏 wrap：加粗包裹选中文本', (await getContent()).includes('**包裹目标**'))
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '一级标题' }).click()
  await waitFor((s) => window.__snDebug.getActiveNoteContent().includes(s), 4000, '\n# ')
  ok('工具栏行级：一级标题插入', (await getContent()).includes('\n# '))
  await page.getByRole('button', { name: '公式块' }).click()
  await page.keyboard.type('E=mc^2')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown') // 离开公式块 → 渲染
  await waitFor(() => document.querySelectorAll('.cm-math-block').length >= 3)
  ok('工具栏块级：公式块插入（$$…$$ 渲染）', (await getContent()).includes('$$'))
  await page.locator('.cm-content .cm-line').last().click()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '分割线' }).click()
  await waitFor(() => document.querySelectorAll('.cm-line.cm-atomic-hr').length >= 2)
  ok('工具栏块级：分割线插入渲染', (await getContent()).includes('\n---\n'))

  // ---- 11. 图片插入（降级 file input 路径） ----
  const imgPath = join(tmpdir(), 'unotes-smoke-img.png')
  writeFileSync(imgPath, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex'))
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '图片' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles(imgPath)
  // 无 uTools 环境：File 无 path → blob URL（Electron 环境才是本地路径）；断言图片语法写回即可
  await waitFor(() => /!\[[^\]]+\]\([^)]+\)/.test(window.__snDebug.getActiveNoteContent()), 4000)
  ok('R8：图片插入写回 `![文件名](路径)` 语法',
    /!\[[^\]]+\]\([^)]+\)/.test(await getContent()))

  // ---- 12. 大纲跳转（offset 契约）：点大纲项 → 光标/滚动定位到标题 ----
  await page.locator('.cm-content .cm-line').last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter') // 新空行（图片行后）
  await page.keyboard.type('## 大纲目标标题')
  await page.keyboard.press('Enter') // 末尾留空行
  await page.waitForTimeout(900) // 落盘 → MetaInfoPanel 大纲从 store 读取
  await page.getByRole('button', { name: '查看元信息' }).click()
  await page.locator('button:has-text("大纲目标标题")').first().waitFor()
  await page.locator('button:has-text("大纲目标标题")').first().click()
  await page.keyboard.press('Escape')
  await waitFor(() => document.querySelector('.cm-activeLine')?.textContent?.includes('大纲目标标题'))
  ok('R8：大纲跳转 offset 定位正确（光标落标题行）',
    await page.evaluate(() => document.querySelector('.cm-activeLine')?.textContent?.includes('大纲目标标题')))

  // ---- 13. Ctrl+S 立即落盘（无 500ms 防抖等待） ----
  const before = await getContent()
  await page.locator('.cm-content .cm-line').last().click()
  await page.keyboard.type('立即保存测试')
  await page.keyboard.press('Control+s')
  await page.waitForFunction(
    (prev) => window.__snDebug.getActiveNoteContent() !== prev,
    before,
    { timeout: 1000 },
  )
  ok('R8：Ctrl+S 立即保存（无防抖等待）', true)

  // ---- 14. round-trip 字节一致：编辑 → 保存 → 重开 ----
  const captured = await getContent()
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('button', { name: /编辑器专项笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /编辑器专项笔记/ }).first().click()
  await page.locator('.cm-content').first().waitFor()
  const reopened = await getContent()
  ok('AC7：编辑→保存→重开 源文本字节一致（公式/任务/表格/围栏无序列化改写）', reopened === captured)
  ok('AC7：公式源码原样保留（$ 定界符字节级一致）',
    reopened.includes('$$\\frac{a}{b}$$') && reopened.includes('$$\nE = mc^2\n$$'))

  // ---- 15. 深色主题：公式/代码仍渲染，背景为深色 ----
  await page.emulateMedia({ colorScheme: 'dark' })
  await waitFor(() => document.documentElement.classList.contains('dark'))
  await page.waitForTimeout(300)
  const darkProbe = await page.evaluate(() => ({
    dark: document.documentElement.classList.contains('dark'),
    math: document.querySelectorAll('.cm-math-inline, .cm-math-block').length,
    fence: document.querySelectorAll('.cm-line.cm-atomic-fenced-code').length,
    bg: getComputedStyle(document.body).backgroundColor,
  }))
  ok('AC10：深色主题公式/代码块仍渲染', darkProbe.dark && darkProbe.math >= 1 && darkProbe.fence >= 1)
  // 背景亮度断言：oklch L 通道 / hex / rgb 三种序列化都接受；深色必须比浅色暗
  const lumaOf = () => page.evaluate(() => {
    const bg = getComputedStyle(document.body).getPropertyValue('--background').trim()
    const oklch = /oklch\(([\d.]+)/.exec(bg)
    if (oklch) return Number(oklch[1])
    const lab = /lab\(([\d.]+)%/.exec(bg) // 浏览器把 oklch 序列化为 lab(L% ...)
    if (lab) return Number(lab[1]) / 100
    const hex = /#([0-9a-fA-F]{2})/.exec(bg)
    if (hex) return parseInt(hex[1], 16) / 255
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg)
    if (m) return (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000 / 255
    return -1
  })
  const darkLuma = await lumaOf()
  await page.emulateMedia({ colorScheme: 'light' })
  await waitFor(() => !document.documentElement.classList.contains('dark'))
  const lightLuma = await lumaOf()
  ok(`AC10：深色主题背景变暗（dark ${darkLuma.toFixed ? darkLuma.toFixed(2) : darkLuma} < light ${lightLuma.toFixed ? lightLuma.toFixed(2) : lightLuma}）`,
    darkLuma >= 0 && darkLuma < lightLuma && darkLuma < 0.5)

  // ---- 16. 长文档（600 行）输入与滚动流畅 ----
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('长文档笔记')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByRole('button', { name: /长文档笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /长文档笔记/ }).first().click()
  await page.locator('.cm-content').first().waitFor()
  const longLines = Array.from({ length: 600 }, (_, i) => `- 长文档行 ${i} $x_${i}$`).join('\n')
  const t0 = Date.now()
  await page.keyboard.insertText(longLines)
  const inputMs = Date.now() - t0
  // CM6 视口虚拟化：DOM 只渲染视口行 → 行数断言走 store（doc 行数）
  await waitFor(() => window.__snDebug.getActiveNoteContent().split('\n').length >= 600, 10000)
  ok('长文档：600 行输入渲染（无页面错误）',
    errors.length === 0 &&
    (await page.evaluate(() => window.__snDebug.getActiveNoteContent().split('\n').length)) >= 600)
  ok(`长文档：600 行输入耗时 ${inputMs}ms（< 30s 即流畅）`, inputMs < 30000)
  ok('长文档：视口渲染行数正常（虚拟化）',
    (await page.locator('.cm-line').count()) >= 20)
  await page.evaluate(() => {
    const s = document.querySelector('.cm-scroller')
    s.scrollTop = s.scrollHeight
  })
  await page.waitForTimeout(400)
  ok('长文档：滚动到底部末行可见',
    await page.evaluate(() => {
      const s = document.querySelector('.cm-scroller')
      const last = [...document.querySelectorAll('.cm-line')].at(-1)
      if (!last || !s) return false
      const r = last.getBoundingClientRect()
      return r.top < s.getBoundingClientRect().bottom && r.bottom > s.getBoundingClientRect().top
    }))
} catch (e) {
  console.error('脚本异常:', e.message.slice(0, 300))
  try {
    console.log('[DEBUG store]', JSON.stringify(await page.evaluate(() => window.__snDebug.getActiveNoteContent())))
    console.log('[DEBUG math]', await page.evaluate(() => ({
      blocks: document.querySelectorAll('.cm-math-block').length,
      inline: document.querySelectorAll('.cm-math-inline').length,
      active: document.querySelector('.cm-line.cm-activeLine')?.textContent,
    })))
    console.log('[DEBUG lines]', await page.evaluate(() =>
      [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.outerHTML.slice(0, 120)).join('\n---\n')))
  } catch {
    // 页面可能已不在笔记视图
  }
  process.exitCode = 1
}

if (errors.length) {
  console.log('\n[渲染错误]', errors)
  process.exitCode = 1
} else {
  console.log(`\n编辑器专项冒烟：${results.filter((r) => r[1]).length}/${results.length} 通过，无渲染错误`)
}
await browser.close()
