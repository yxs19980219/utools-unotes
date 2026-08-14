#!/usr/bin/env node
/**
 * UI 冒烟测试（编辑器专项）：Milkdown/Crepe WYSIWYG 渲染与工具栏契约。
 *
 * 覆盖 ui-smoke.mjs 之外的编辑器专项：公式（KaTeX）、深色主题、大纲跳转、
 * 工具栏 19 项（wrap/行级/块级）、图片插入、Ctrl+S。
 *
 * 前置：dev server 在 5174 运行（npm run dev）。
 * 运行：npm run smoke:editor
 */
import { chromium } from 'playwright-core'
import { existsSync, writeFileSync } from 'node:fs'

const EDGE_CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean)
const executablePath = EDGE_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('未找到系统 Edge/Chrome，可用 BROWSER_PATH 指定')
  process.exit(1)
}

const base = process.env.UI_SMOKE_BASE ?? 'http://localhost:5174/'
const results = []
const ok = (name, pass) => {
  results.push([name, pass])
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`)
}

writeFileSync('C:/Users/Fengzhi/AppData/Local/Temp/opencode/smoke-img.png', Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text().slice(0, 200))
})

/** 打开笔记：dispatchEvent 派发 click（规避 dev 环境偶发 hit-test 拦截）+ 等待编辑器 */
async function openNoteByTitle(title) {
  for (let i = 0; i < 3; i += 1) {
    await page.locator('[role="button"]', { hasText: title }).first().dispatchEvent('click')
    try {
      await page.locator('.milkdown .ProseMirror').first().waitFor({ timeout: 8000 })
      return
    } catch {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
  }
  throw new Error(`open note failed: ${title}`)
}

const pm = () => page.locator('.milkdown .ProseMirror').first()
const has = async (sel) => (await page.locator(sel).count()) >= 1

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '新建对象' }).first().waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '新建对象' }).first().click()
  await page.getByLabel('标题').fill('编辑器专项验证')
  await page.getByRole('button', { name: '创建' }).click()
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('专项笔记')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByText('专项笔记').first().waitFor({ timeout: 15000 })
  await openNoteByTitle('专项笔记')
  ok('编辑器渲染', true)

  const typeBlock = async (text) => {
    await page.keyboard.type(text, { delay: 20 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
  }

  // ---- 即时渲染（痛点 R1-R5）----
  await typeBlock('# 标题一')
  await typeBlock('行内公式 $x^2 + y^2$ 结束')
  await typeBlock('- [ ] 待办甲')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  await typeBlock('> 引用内容')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  await typeBlock('```js')
  await typeBlock('const a = 1')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  await typeBlock('---')
  await page.waitForTimeout(800)

  ok('标题 h1 渲染', await has('.milkdown h1'))
  ok('行内公式 KaTeX 渲染', await has('.milkdown .katex'))
  ok('任务列表勾选框（无 - [ ] 残留）',
    (await has('.milkdown .milkdown-list-item-block .label')) &&
    !(await page.locator('.milkdown').innerText()).includes('- [ ]'))
  ok('引用块渲染（无 > 残留）',
    (await has('.milkdown blockquote')) &&
    !(await page.locator('.milkdown blockquote').first().innerText()).includes('>'))
  ok('代码块渲染（Crepe code-block）', await has('.milkdown .milkdown-code-block'))
  ok('分割线渲染 hr', await has('.milkdown hr'))

  // ---- 深色主题（R10）----
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  const darkBg = await page.evaluate(() => {
    const m = document.querySelector('.milkdown')
    return m ? getComputedStyle(m).getPropertyValue('--crepe-color-background').trim() : ''
  })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  ok('深色主题变量生效', darkBg.length > 0)

  // ---- 大纲跳转（AC9）----
  await page.getByRole('button', { name: '查看元信息' }).click()
  await page.waitForTimeout(400)
  ok('元信息面板含大纲项', (await page.getByText('标题一', { exact: true }).count()) >= 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: '查看元信息' }).click()
  await page.waitForTimeout(300)
  await page.getByText('标题一', { exact: true }).first().click()
  await page.waitForTimeout(300)
  const selText = await pm().evaluate((el) => window.getSelection()?.anchorNode?.textContent ?? '')
  ok('大纲跳转定位到标题', (selText ?? '').includes('标题一'))

  // ---- 工具栏 19 项（AC8）----
  const clickTool = async (label) => {
    await page.getByRole('button', { name: label }).first().click()
    await page.waitForTimeout(350)
  }
  await clickTool('一级标题')
  ok('行级 h1', await has('.milkdown h1'))
  await page.keyboard.press('Enter')
  await clickTool('二级标题')
  ok('行级 h2', await has('.milkdown h2'))
  await page.keyboard.press('Enter')
  await clickTool('无序列表')
  ok('行级 ul', await has('.milkdown .milkdown-list-item-block'))
  await page.keyboard.press('Enter')
  await clickTool('有序列表')
  ok('行级 ol', await has('.milkdown ol'))
  await page.keyboard.press('Enter')
  await clickTool('勾选框')
  ok('行级 task 勾选框', await has('.milkdown .milkdown-list-item-block .label'))
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await clickTool('引用')
  ok('行级 blockquote', await has('.milkdown blockquote'))
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await clickTool('代码块')
  ok('块级 codeblock', await has('.milkdown .milkdown-code-block'))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await clickTool('公式块')
  ok('块级 mathblock（LaTeX 代码块）', await has('.milkdown .milkdown-code-block .language-button'))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await clickTool('表格')
  ok('块级 table', await has('.milkdown table, .milkdown .table-block'))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await clickTool('分割线')
  ok('块级 hr', await has('.milkdown hr'))

  const wrapTest = async (label, sel) => {
    await page.keyboard.press('Enter')
    await page.keyboard.type('验证文本', { delay: 15 })
    await page.waitForTimeout(200)
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft')
    await clickTool(label)
    ok(`wrap ${label}`, await has(sel))
  }
  await wrapTest('加粗', '.milkdown strong')
  await wrapTest('斜体', '.milkdown em')
  await wrapTest('删除线', '.milkdown s, .milkdown del')
  await wrapTest('内联代码', '.milkdown code')
  await wrapTest('链接', '.milkdown a[href]')
  await wrapTest('内联公式', '.milkdown .katex')

  // ---- 图片插入（浏览器降级 input[type=file]）----
  await page.locator('[role="toolbar"] [aria-label="图片"]').first().dispatchEvent('click')
  await page.waitForTimeout(500)
  const fileInput = page.locator('input[type=file]').first()
  await fileInput.setInputFiles('C:/Users/Fengzhi/AppData/Local/Temp/opencode/smoke-img.png')
  await page.waitForTimeout(1000)
  const imgSrc = await page
    .locator('.milkdown img, .milkdown .image-block img, .milkdown .image-inline img')
    .first()
    .getAttribute('src')
    .catch(() => null)
  ok('图片插入渲染（img src 有效）', !!imgSrc)

  // ---- Ctrl+S（编辑器内焦点）----
  await pm().click()
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(400)
  ok('Ctrl+S 无异常', errors.length === 0)

  // ---- 保存链路 round-trip（AC7）----
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '返回' }).first().click()
  await page.waitForTimeout(400)
  await openNoteByTitle('专项笔记')
  const bodyText = await page.evaluate(() => document.body.innerText)
  ok('保存链路：重开后内容保留', bodyText.includes('待办甲') && bodyText.includes('引用内容'))
} catch (e) {
  console.error('SMOKE ERROR:', e.message)
  results.push(['exception', false])
}

console.log('\n--- errors ---')
for (const e of errors.slice(0, 10)) console.log('  ' + e)
console.log(`\nTOTAL: ${results.filter((r) => r[1]).length}/${results.length} passed`)
await browser.close()
process.exit(results.every((r) => r[1]) ? 0 : 1)
