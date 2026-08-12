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

  // 2. 新建笔记：仅标题+标签（无正文编辑器），保存后回列表
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.waitForTimeout(500)
  await page.getByLabel('标题').fill('冒烟笔记')
  const hasBodyEditor = await page.evaluate(() => !!document.querySelector('.cm-content'))
  ok('新建笔记无正文编辑器（快速创建）', !hasBodyEditor)
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(800)
  ok('笔记卡片出现', (await page.evaluate(() => document.body.innerText)).includes('冒烟笔记'))

  // 3. 点卡片 → 详情内联编辑器（空正文直接可写）
  await page.getByText('冒烟笔记').first().click()
  await page.waitForTimeout(600)
  await page.locator('.cm-content').click()
  await page.keyboard.type('# 标题\n- 列表项一\n- 列表项二')
  await page.waitForTimeout(400)
  const deco = await page.evaluate(() => {
    const cm = document.querySelector('.cm-content')
    return {
      dimCount: cm?.querySelectorAll('.sn-md-dim').length ?? 0,
      headingStyled: !!cm?.querySelector('.cm-line .sn-md-h1'),
    }
  })
  ok('即时渲染：标题样式装饰', deco.headingStyled)
  ok('即时渲染：列表标记淡色（- 符号）', deco.dimCount >= 2)
  await page.getByRole('button', { name: '保存正文' }).click()
  await page.waitForTimeout(800)
  const saved = await page.evaluate(() => document.body.innerText)
  ok('正文保存后只读渲染', saved.includes('列表项一'))

  // 4. 钉住 → 首页钉住区（新建对象默认钉住 + 手动钉住兼容）
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(500)
  ok('首页钉住区出现对象', (await page.evaluate(() => document.body.innerText)).includes('UI 冒烟测试对象'))
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
