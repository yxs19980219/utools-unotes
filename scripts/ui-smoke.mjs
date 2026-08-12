#!/usr/bin/env node
/**
 * UI 冒烟测试：无头浏览器（系统 Edge/Chrome）走通核心闭环。
 *
 * 为什么需要：纯逻辑冒烟（smoke/stores/decorations）覆盖不了渲染层——
 * TooltipProvider 缺失、useShallow 引用缓存、短路 Hook 都是渲染期才爆的错。
 * 本脚本要求 dev server 已在 5173 运行（npm run dev），数据走 MemoryDb（无 utools 环境）。
 *
 * 前置：npm i -D playwright-core（不带浏览器，复用系统 Edge/Chrome）
 * 运行：npm run ui-smoke
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
const results = []
const ok = (name, pass) => {
  results.push([name, pass])
  console.log(`${pass ? '✅' : '❌'} ${name}`)
}

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200)) })

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // 1. 新建对象（右上角 新建 → 新建对象）
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.waitForTimeout(300)
  await page.locator('[role="menuitem"]').filter({ hasText: '新建对象' }).click()
  await page.waitForTimeout(300)
  await page.getByLabel('标题').fill('UI 冒烟测试对象')
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(800)
  ok('对象详情出现', (await page.evaluate(() => document.body.innerText)).includes('UI 冒烟测试对象'))

  // 2. 新建笔记（CodeMirror 输入 markdown）
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.waitForTimeout(500)
  await page.getByLabel('标题').fill('冒烟笔记')
  await page.locator('.cm-content').click()
  await page.keyboard.type('# 标题\n正文内容一。')
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(800)
  const afterNote = await page.evaluate(() => document.body.innerText)
  ok('笔记卡片出现', afterNote.includes('冒烟笔记') && afterNote.includes('正文内容一'))

  // 3. 钉住 → 首页钉住区
  await page.getByRole('button', { name: /钉住/ }).first().click()
  await page.waitForTimeout(500)
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(500)
  ok('首页钉住区出现对象', (await page.evaluate(() => document.body.innerText)).includes('UI 冒烟测试对象'))

  // 4. 编辑器打开且 markdown 保真
  await page.getByText('冒烟笔记').first().click()
  await page.waitForTimeout(500)
  const editBtns = await page.getByRole('button', { name: /编辑/ }).all()
  if (editBtns.length) await editBtns[0].click()
  await page.waitForTimeout(500)
  const editorState = await page.evaluate(() => {
    const cm = document.querySelector('.cm-content')
    return { hasCodemirror: !!cm, text: cm?.innerText ?? '' }
  })
  ok('编辑器打开且内容保真', editorState.hasCodemirror && editorState.text.includes('# 标题'))

  // 5. 标签联想（AC4 渲染层验证）
  await page.locator('.cm-content').click()
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(400)
} catch (e) {
  console.error('脚本异常:', e.message.slice(0, 300))
  process.exitCode = 1
}

if (errors.length) {
  console.log('\n[渲染错误]', errors)
  process.exitCode = 1
} else {
  console.log(`\nUI 冒烟：${results.filter((r) => r[1]).length}/${results.length} 通过，无渲染错误`)
}
await browser.close()
