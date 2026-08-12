#!/usr/bin/env node
/**
 * UI 冒烟测试：无头浏览器（系统 Edge/Chrome）走通核心闭环（三期交互）。
 *
 * 三期覆盖：新建对象入口（侧边栏空态 CTA / 活跃对象组 + 按钮）、对象详情唯一顶栏、
 * 侧边栏对象行右键菜单（编辑/归档/删除）、归档/恢复流程（恢复直回首页活跃列表）、
 * 设置流程（来源类型增删 + 偏好）、草稿保护（AC8/AC9 + 空正文）、800×600 无横向滚动。
 *
 * 前置：dev server 已在 5173 运行（npm run dev），数据走 MemoryDb（无 utools 环境）。
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

  // 1. 新建对象：首页空态 CTA（三期：无顶部「新建▾」，入口 = 侧边栏空态 CTA / 活跃对象组 +）
  ok('无顶部新建▾下拉', (await page.getByRole('button', { name: '新建', exact: true }).count()) === 0)
  await page.getByRole('button', { name: '新建对象' }).first().click()
  await page.waitForTimeout(300)
  await page.getByLabel('标题').fill('UI 冒烟测试对象')
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForTimeout(800)
  // 对象详情：唯一顶栏（标题 + 笔记数 + 新笔记），无重复标题行
  const detailText = await page.evaluate(() => document.body.innerText)
  ok('对象详情顶栏出现（标题+笔记数）', detailText.includes('UI 冒烟测试对象') && detailText.includes('笔记 · 0'))
  ok('对象详情顶栏有新笔记按钮', (await page.getByRole('button', { name: /新笔记/ }).count()) >= 1)

  // 1b. 首页侧边栏：活跃对象分组出现对象（三期：无「钉住对象」分组）
  const sidebarText = await page.locator('aside').innerText()
  ok('首页侧边栏「活跃对象」分组', sidebarText.includes('活跃对象') && sidebarText.includes('UI 冒烟测试对象'))

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

  // 4. 返回对象详情 → 首页活跃列表（三期：无重新钉住概念）
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(500)
  ok('首页活跃列表出现对象', await page.locator('aside').getByText('UI 冒烟测试对象').first().isVisible())

  // 4b. AC12：800×600 无横向滚动
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }))
  ok('AC12：800×600 无横向滚动', overflow.sw <= overflow.cw)

  // 5. 对象行右键菜单（AC3）：编辑/归档/删除 出现
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click({ button: 'right' })
  await page.waitForTimeout(400)
  const menuText = await page.locator('[role="menu"]').innerText()
  ok('AC3：右键菜单含 编辑/归档/删除',
    menuText.includes('编辑') && menuText.includes('归档') && menuText.includes('删除'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 6. 归档流程（AC1/AC2/AC6）：顶栏归档 → 归档视图只读 → 恢复直回首页
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '归档对象' }).click()
  await page.waitForTimeout(300)
  const archiveDialog = page.getByRole('alertdialog')
  ok('AC1：归档确认框提示笔记转只读', (await archiveDialog.innerText()).includes('1 条笔记将一并转为只读'))
  await archiveDialog.getByRole('button', { name: '归档', exact: true }).click()
  await page.waitForTimeout(700)
  ok('归档成功提示', (await page.evaluate(() => document.body.innerText)).includes('已归档'))
  // 首页活跃列表消失
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(500)
  ok('AC1：归档后首页活跃列表消失', (await page.locator('aside').getByText('UI 冒烟测试对象').count()) === 0)
  // 归档视图：对象出现 → 只读详情
  await page.getByRole('tab', { name: '归档' }).click()
  await page.waitForTimeout(500)
  ok('归档侧边栏出现对象', await page.locator('aside').getByText('UI 冒烟测试对象').first().isVisible())
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.waitForTimeout(500)
  const archivedDetail = await page.evaluate(() => document.body.innerText)
  ok('AC2：归档详情只读（无新笔记/编辑，有恢复+已归档）',
    archivedDetail.includes('已归档（只读）') &&
    (await page.getByRole('button', { name: /新笔记/ }).count()) === 0 &&
    (await page.getByRole('button', { name: '恢复', exact: true }).count()) === 1)
  // 归档笔记 → 只读 NoteView（无写正文入口）
  await page.getByText('冒烟笔记').first().click()
  await page.waitForTimeout(500)
  const archivedNote = await page.evaluate(() => document.body.innerText)
  ok('归档笔记只读 NoteView', archivedNote.includes('已归档（只读）') &&
    (await page.getByRole('button', { name: /写正文/ }).count()) === 0)
  // 归档视图对象行右键 = 恢复/删除
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click({ button: 'right' })
  await page.waitForTimeout(400)
  const archivedMenu = await page.locator('[role="menu"]').innerText()
  ok('AC6：归档行右键含 恢复/删除',
    archivedMenu.includes('恢复') && archivedMenu.includes('删除') && !archivedMenu.includes('编辑'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  // 恢复（顶栏按钮）→ 立即回首页活跃列表（AC7：无需重新钉住）
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByRole('alertdialog').getByRole('button', { name: '恢复', exact: true }).click()
  await page.waitForTimeout(700)
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(500)
  ok('AC7：恢复后立即出现在首页活跃列表',
    await page.locator('aside').getByText('UI 冒烟测试对象').first().isVisible())

  // 7. 设置流程（AC4/AC5/AC6）：新增类型 → 下拉生效 → 删除（引用计数）→ 偏好
  await page.getByRole('tab', { name: '设置' }).click()
  await page.waitForTimeout(500)
  await page.getByLabel('新类型名称').fill('播客')
  await page.getByRole('button', { name: '添加' }).click()
  await page.waitForTimeout(600)
  ok('新增类型出现', (await page.evaluate(() => document.body.innerText)).includes('播客'))
  // AC4：新建对象来源下拉立即出现「播客」（入口 = 首页活跃对象组 +）
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '新建对象' }).click()
  await page.waitForTimeout(300)
  await page.getByLabel('来源类型').click()
  await page.waitForTimeout(300)
  const hasPodcastOption = await page.getByRole('option', { name: '播客' }).count()
  ok('AC10：对象表单无标签输入', (await page.getByLabel('标签').count()) === 0)
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
  ok('AC5：删除后类型消失',
    (await page.getByRole('button', { name: '删除 播客' }).count()) === 0)
  // AC6：偏好默认排序 → 创建时间（保存提示）
  await page.getByLabel('默认排序').click()
  await page.waitForTimeout(300)
  await page.getByRole('option', { name: '创建时间' }).click()
  await page.waitForTimeout(500)
  ok('AC6：偏好保存提示', (await page.evaluate(() => document.body.innerText)).includes('偏好已保存'))

  // 7b. 搜索态（S1 回归：顶栏与 ContentArea 优先级一致 + relevance + 来源筛选）
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(400)
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__snDebug.setSearch('冒烟'))
  await page.waitForTimeout(500)
  ok('搜索态顶栏：搜索结果 + 无对象操作区',
    (await page.evaluate(() => document.body.innerText)).includes('搜索结果') &&
    (await page.getByRole('button', { name: '归档对象' }).count()) === 0)
  ok('搜索态来源筛选出现', (await page.getByLabel('来源类型筛选').count()) === 1)
  await page.getByRole('button', { name: '排序' }).click()
  await page.waitForTimeout(300)
  ok('搜索态排序含相关度', (await page.locator('[role="menuitemradio"]').filter({ hasText: '相关度' }).count()) === 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__snDebug.setSearch(''))
  await page.waitForTimeout(500)
  ok('退出搜索回对象详情顶栏', (await page.getByRole('button', { name: '归档对象' }).count()) === 1)

  // 8. 草稿保护（AC8 全流程 + AC9 自动落盘）
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(400)
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.waitForTimeout(500)
  await page.getByText('冒烟笔记').first().click()
  await page.waitForTimeout(500)
  // AC9：NoteView 顶栏（返回按钮所在行）无对象名，只有笔记自身信息
  const noteHeaderText = await page
    .getByRole('button', { name: /返回/ })
    .first()
    .locator('xpath=..')
    .innerText()
  ok('AC9：笔记详情顶栏无对象名',
    !noteHeaderText.includes('UI 冒烟测试对象') && noteHeaderText.includes('冒烟笔记'))
  // 三期反馈：进入笔记后顶部对象栏整体隐藏（ContentHeader 不渲染）
  ok('进入笔记后对象栏隐藏（无归档按钮）',
    (await page.getByRole('button', { name: '归档对象' }).count()) === 0)
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

  // 9. 空正文笔记（可写即所见）草稿保护
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.waitForTimeout(500)
  await page.getByLabel('标题').fill('空正文草稿')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(700)
  await page.getByText('空正文草稿').first().click()
  await page.waitForTimeout(500)
  ok('空正文笔记直接进入编辑器', await page.evaluate(() => !!document.querySelector('.cm-content')))
  await page.locator('.cm-content').click()
  await page.keyboard.type('空正文草稿内容')
  await page.waitForTimeout(700)
  const emptyDraftKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sn:draft:')))
  ok('空正文编辑也自动暂存', emptyDraftKeys.length === 1)
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.waitForTimeout(400)
  ok('空正文编辑切走弹确认框', await page.getByRole('alertdialog').getByText('有未保存的改动').isVisible())
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃更改' }).click()
  await page.waitForTimeout(600)
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sn:draft:')).forEach((k) => localStorage.removeItem(k)))

  // 10. AC3 右键删除执行（级联）：删除「播客对象」
  await page.getByRole('tab', { name: '首页' }).click()
  await page.waitForTimeout(400)
  await page.locator('aside').getByText('播客对象').first().click({ button: 'right' })
  await page.waitForTimeout(400)
  await page.locator('[role="menu"]').getByText('删除').click()
  await page.waitForTimeout(400)
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(700)
  ok('AC3：右键删除执行（级联消失）',
    (await page.locator('aside').getByText('播客对象').count()) === 0)
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
