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
// 800×600：uTools 插件窗口最小尺寸（AC12：无横向滚动）
const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
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
      bulletCount: cm?.querySelectorAll('.sn-list-bullet').length ?? 0,
      headingStyled: !!cm?.querySelector('.cm-line .sn-md-h1'),
    }
  })
  ok('即时渲染：标题样式装饰', deco.headingStyled)
  ok('即时渲染：无序列表 • 项目符号', deco.bulletCount >= 2)

  // 3b. 快捷工具栏：点击「勾选框」插入任务列表
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '勾选框' }).click()
  await page.keyboard.type('待办项')
  await page.waitForTimeout(300)
  const taskCount = await page.evaluate(() => document.querySelectorAll('.sn-task-box').length)
  ok('快捷工具栏：勾选框插入', taskCount >= 1)
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

  // 4b. AC12：800×600 无横向滚动
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }))
  ok('AC12：800×600 无横向滚动', overflow.sw <= overflow.cw)

  // 5. 归档流程（AC1/AC2/AC3）：详情归档 → 归档视图只读 → 恢复
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '归档对象' }).click()
  await page.waitForTimeout(300)
  const archiveDialog = page.getByRole('alertdialog')
  ok('归档确认框提示笔记转只读', (await archiveDialog.innerText()).includes('1 条笔记将一并转为只读'))
  await archiveDialog.getByRole('button', { name: '归档', exact: true }).click()
  await page.waitForTimeout(700)
  ok('归档成功提示', (await page.evaluate(() => document.body.innerText)).includes('已归档'))
  await page.getByRole('tab', { name: '归档' }).click()
  await page.waitForTimeout(500)
  ok('归档侧边栏出现对象', await page.locator('aside').getByText('UI 冒烟测试对象').first().isVisible())
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.waitForTimeout(500)
  const archivedDetail = await page.evaluate(() => document.body.innerText)
  ok('归档详情只读：无新笔记按钮 + 恢复按钮',
    archivedDetail.includes('已归档（只读）') &&
    (await page.getByRole('button', { name: /新笔记/ }).count()) === 0 &&
    (await page.getByRole('button', { name: '恢复', exact: true }).count()) === 1)
  // 归档笔记 → 只读 NoteView（无写正文入口）
  await page.getByText('冒烟笔记').first().click()
  await page.waitForTimeout(500)
  const archivedNote = await page.evaluate(() => document.body.innerText)
  ok('归档笔记只读 NoteView',
    archivedNote.includes('已归档（只读）') &&
    (await page.getByRole('button', { name: /写正文/ }).count()) === 0)
  // 恢复
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByRole('alertdialog').getByRole('button', { name: '恢复', exact: true }).click()
  await page.waitForTimeout(700)
  ok('恢复成功提示', (await page.evaluate(() => document.body.innerText)).includes('已恢复'))
  // 恢复后不自动钉住（R3）：首页侧边栏无该对象；手动钉住后出现
  await page.getByRole('button', { name: '钉住对象' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(500)
  ok('恢复后重新钉住上首页', await page.locator('aside').getByText('UI 冒烟测试对象').first().isVisible())

  // 6. 设置流程（AC4/AC5/AC6）：新增类型 → 下拉生效 → 删除（引用计数）→ 偏好
  await page.getByRole('tab', { name: '设置' }).click()
  await page.waitForTimeout(500)
  await page.getByLabel('新类型名称').fill('播客')
  await page.getByRole('button', { name: '添加' }).click()
  await page.waitForTimeout(600)
  ok('新增类型出现', (await page.evaluate(() => document.body.innerText)).includes('播客'))
  // AC4：新建对象来源下拉立即出现「播客」（无需刷新）
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.waitForTimeout(300)
  await page.locator('[role="menuitem"]').filter({ hasText: '新建对象' }).click()
  await page.waitForTimeout(300)
  await page.getByLabel('来源类型').click()
  await page.waitForTimeout(300)
  const hasPodcastOption = await page.getByRole('option', { name: '播客' }).count()
  await page.getByRole('option', { name: '播客' }).click()
  await page.getByLabel('标题').fill('播客对象')
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(700)
  ok('AC4：来源下拉即时出现「播客」且可创建对象', hasPodcastOption === 1 &&
    (await page.evaluate(() => document.body.innerText)).includes('播客'))
  // AC5：删除被引用类型 → 确认含引用计数 → 删除后消失
  await page.getByRole('tab', { name: '设置' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '删除 播客' }).click()
  await page.waitForTimeout(500)
  const delDialog = page.getByRole('alertdialog')
  ok('AC5：删除确认含引用计数', (await delDialog.innerText()).includes('1 个对象使用该类型'))
  await delDialog.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(600)
  // 精确断言：类型行（删除按钮）已消失（body 文本含 toast「已删除」关键词，不能用文本匹配）
  ok('AC5：删除后类型消失',
    (await page.getByRole('button', { name: '删除 播客' }).count()) === 0)
  // AC6：偏好默认排序 → 创建时间（保存提示）
  await page.getByLabel('默认排序').click()
  await page.waitForTimeout(300)
  await page.getByRole('option', { name: '创建时间' }).click()
  await page.waitForTimeout(500)
  ok('AC6：偏好保存提示', (await page.evaluate(() => document.body.innerText)).includes('偏好已保存'))

  // 7. 草稿保护（AC8 全流程 + AC9 自动落盘）
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(400)
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.waitForTimeout(500)
  await page.getByText('冒烟笔记').first().click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /写正文/ }).click()
  await page.waitForTimeout(400)
  await page.locator('.cm-content').click()
  await page.keyboard.type('\n草稿内容测试')
  await page.waitForTimeout(700) // 防抖 500ms 落盘
  const draftKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sn:draft:')))
  ok('AC9：草稿自动暂存 localStorage', draftKeys.length === 1 &&
    (await page.evaluate((k) => localStorage.getItem(k), draftKeys[0])).includes('草稿内容测试'))
  // 返回 → 确认框（AC8）
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  ok('AC8：切走弹确认框', await page.getByRole('alertdialog').getByText('有未保存的改动').isVisible())
  await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(400)
  ok('AC8：取消留在编辑态', (await page.evaluate(() => !!document.querySelector('.cm-content'))))
  // 再返回 → 放弃 → 回列表且草稿已清
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃更改' }).click()
  await page.waitForTimeout(600)
  const draftAfterDiscard = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sn:draft:')))
  ok('AC8：放弃丢失改动并返回（草稿已清）',
    (await page.evaluate(() => !!document.querySelector('.cm-content'))) === false &&
    draftAfterDiscard.length === 0)
  // 重进笔记：无恢复提示（放弃已清）
  await page.getByText('冒烟笔记').first().click()
  await page.waitForTimeout(500)
  const afterReenter = await page.evaluate(() => document.body.innerText)
  ok('放弃后重进无草稿恢复', !afterReenter.includes('已恢复未保存的草稿'))
  // 清理：删除测试草稿 key（防泄漏）
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sn:draft:')).forEach((k) => localStorage.removeItem(k)))

  // 8. 空正文笔记（可写即所见）草稿保护（S1 场景：editingBody=false 但编辑器可见）
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.waitForTimeout(500)
  await page.getByLabel('标题').fill('空正文草稿')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(700)
  await page.getByText('空正文草稿').first().click()
  await page.waitForTimeout(500)
  // 空正文：编辑器直接可见（无需点「写正文」）
  ok('空正文笔记直接进入编辑器', await page.evaluate(() => !!document.querySelector('.cm-content')))
  await page.locator('.cm-content').click()
  await page.keyboard.type('空正文草稿内容')
  await page.waitForTimeout(700) // 防抖落盘
  const emptyDraftKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sn:draft:')))
  ok('空正文编辑也自动暂存', emptyDraftKeys.length === 1)
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  ok('空正文编辑切走弹确认框', await page.getByRole('alertdialog').getByText('有未保存的改动').isVisible())
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃更改' }).click()
  await page.waitForTimeout(600)
  // 清理草稿 key（防泄漏）
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sn:draft:')).forEach((k) => localStorage.removeItem(k)))
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
