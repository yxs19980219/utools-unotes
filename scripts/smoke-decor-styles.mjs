#!/usr/bin/env node
/**
 * 装饰计算样式冒烟测试（uTools 真实内核等价验证通道，R5）。
 *
 * 用途：ui-smoke 只断言装饰"存在"，本脚本断言装饰在目标内核（Chromium ≤108，
 * 即 uTools 7.x 实际内核）上"真正渲染"——计算样式级验证：
 *  - 粗体/删除线标记非光标行 display:none（Typora 式隐藏）
 *  - 粗体内容 font-weight 生效
 *  - 代码块背景/圆角（var(--muted) / var(--radius-sm)）
 *  - 表格宽度自适应（非 100% 占满）、hover 工具条默认不可见
 *  - color-mix 兼容变量在旧内核的 rgba 兜底值（背景非 transparent）
 *
 * 前置：dev server 已在 5173 运行（npm run dev），数据走 MemoryDb。
 * 运行：
 *   npm run smoke:decor-styles                                  # 现代 Chrome（无 BROWSER_PATH 时自动找系统浏览器）
 *   BROWSER_PATH=<Chrome107/chrome.exe> npm run smoke:decor-styles   # uTools 内核等价（Chromium ≤108）
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
const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200))
})

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '新建对象' }).first().waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '新建对象' }).first().click()
  await page.getByLabel('标题').fill('装饰样式验证')
  await page.getByRole('button', { name: '创建' }).click()
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('样式笔记')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByText('样式笔记').first().click()
  await page.locator('.cm-content').first().waitFor()

  // 输入：粗体 + 代码块（手动闭合）+ 表格（工具栏一次性插入——
  // 手动逐行输入表格时，分隔行出现瞬间 widget 原子化会把光标推挤到文档前部）
  const cm = page.locator('.cm-content').first()
  await cm.click()
  await page.keyboard.type('这是**粗体测试**和~~删除线~~')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```ts')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const x = 1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '表格', exact: true }).click()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)

  const r = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel)
    const qa = (sel) => [...document.querySelectorAll(sel)]
    const style = (sel, prop) => {
      const e = q(sel)
      return e ? getComputedStyle(e)[prop] : '(none)'
    }
    // 粗体内容元素（sn-md-bold 是内容 span；其兄弟/自身内不含标记）
    const boldEl = q('.sn-md-bold')
    const boldLine = boldEl?.closest('.cm-line')
    // 非光标行：标记 span（display:none）与内容 span（加粗）同线
    const dimOrHidden = boldLine ? [...boldLine.querySelectorAll('.sn-md-dim, .sn-md-hidden')] : []
    return {
      bold: {
        count: qa('.sn-md-bold').length,
        fontWeight: style('.sn-md-bold', 'fontWeight'),
        text: boldEl?.textContent ?? '(none)',
      },
      boldMarkerHidden: dimOrHidden.every((el) => {
        const cs = getComputedStyle(el)
        // 零宽隐藏（font-size:0，不断裂选区）而非 display:none
        return cs.display !== 'none' && cs.fontSize === '0px'
      }),
      strike: {
        count: qa('.sn-md-strike').length,
        decoration: style('.sn-md-strike', 'textDecorationLine'),
      },
      codeblock: {
        count: qa('.sn-md-codeblock-widget').length,
        bg: style('.sn-md-codeblock-widget', 'backgroundColor'),
        radius: style('.sn-md-codeblock-widget', 'borderRadius'),
        nestedCount: qa('.sn-md-codeblock-widget .cm-content').length,
        noFenceVisible: !(q('.sn-md-codeblock-widget')?.innerText ?? '').includes('```'),
      },
      fenceHidden: qa('.sn-md-hidden').length,
      langPicker: (() => {
        const l = q('.sn-md-codeblock-widget .sn-lang-picker')
        return l ? { visible: l.offsetParent !== null, value: l.value, bg: getComputedStyle(l).backgroundColor } : '(none)'
      })(),
      table: {
        count: qa('.sn-md-table-widget').length,
        widgetW: q('.sn-md-table-widget') ? Math.round(q('.sn-md-table-widget').getBoundingClientRect().width) : 0,
        containerW: q('.sn-md-table-widget') ? Math.round(q('.sn-md-table-widget').parentElement.getBoundingClientRect().width) : 0,
        bg: style('.sn-md-table-widget', 'backgroundColor'),
        border: style('.sn-md-table-widget', 'borderTopWidth'),
      },
      toolbar: (() => {
        const t = q('.sn-md-table-toolbar')
        return t ? { opacity: getComputedStyle(t).opacity } : '(none)'
      })(),
      activeLineBg: style('.cm-activeLine', 'backgroundColor'),
    }
  })

  // ---- 断言 ----
  ok('粗体：内容加粗且标记零宽隐藏（Typora 式，选区不断裂）',
    r.bold.count >= 1 && r.bold.fontWeight !== '400' && r.boldMarkerHidden)
  ok('删除线：内容删除线样式', r.strike.count >= 1 && r.strike.decoration.includes('line-through'))
  ok('代码块：独立输入框（widget + nested editor + 无围栏可见）',
    r.codeblock.count >= 1 && r.codeblock.nestedCount >= 1 && r.codeblock.noFenceVisible)
  ok('代码块：背景生效 + 圆角（var 兼容）',
    r.codeblock.bg !== 'rgba(0, 0, 0, 0)' && r.codeblock.bg !== 'transparent' && r.codeblock.radius !== '0px')
  ok('代码块：语言选择器常驻可见（header pill）',
    r.langPicker !== '(none)' && r.langPicker.visible && r.langPicker.bg !== 'rgba(0, 0, 0, 0)')
  ok('表格：外框按内容宽度（未占满整行）', r.table.count >= 1 && r.table.widgetW > 0 && r.table.widgetW < r.table.containerW - 20)
  ok('表格：背景非透明（color-mix 兜底值生效）', r.table.bg !== 'rgba(0, 0, 0, 0)' && r.table.bg !== 'transparent')
  ok('表格：边框生效', r.table.border !== '0px')
  ok('工具条：默认不可见（hover 悬浮）', r.toolbar !== '(none)' && Number(r.toolbar.opacity) === 0)
  ok('活动行背景非透明（--editor-accent-45 生效）', r.activeLineBg !== 'rgba(0, 0, 0, 0)' && r.activeLineBg !== 'transparent')

  // 深色模式：--editor-* 变量随 html.dark 切换为深色 rgba 兜底
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.waitForTimeout(300)
  const dark = await page.evaluate(() => ({
    tableBg: getComputedStyle(document.querySelector('.sn-md-table-widget')).backgroundColor,
    varValue: getComputedStyle(document.documentElement).getPropertyValue('--editor-muted-35').trim(),
  }))
  ok('深色模式：表格背景随 html.dark 切换生效',
    dark.tableBg !== 'rgba(0, 0, 0, 0)' && dark.tableBg !== 'transparent' && dark.varValue !== '')
  ok('无渲染错误', errors.length === 0)
} catch (e) {
  console.error('脚本异常:', e.message.slice(0, 300))
  ok('流程走通', false)
} finally {
  await browser.close()
  const failed = results.filter(([, pass]) => !pass)
  console.log(`装饰样式冒烟：${results.length - failed.length}/${results.length} 通过${failed.length ? '，失败：' + failed.map(([n]) => n).join('；') : ''}`)
  process.exit(failed.length ? 1 : 0)
}
