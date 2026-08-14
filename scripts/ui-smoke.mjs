#!/usr/bin/env node
/**
 * UI 冒烟测试：无头浏览器（系统 Edge/Chrome）走通核心闭环（三期交互 + 实时保存）。
 *
 * 三期覆盖：新建对象入口（侧边栏空态 CTA / 活跃对象组 + 按钮）、对象详情唯一顶栏、
 * 侧边栏对象行右键菜单（编辑/归档/删除）、归档/恢复流程（恢复直回首页活跃列表）、
 * 设置流程（来源类型增删 + 偏好）、实时保存（防抖落盘/无确认框/无 localStorage 草稿）、
 * 800×600 无横向滚动。
 *
 * 提速约定：除防抖落盘等待（500ms 防抖 → 固定 900ms）外，一律用 waitFor 条件等待
 * （轮询 DOM 条件，元素已满足时立即返回），不用固定 waitForTimeout。
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

/** 条件等待：轮询页面条件（默认 5s 超时），条件已满足时立即返回（替代固定等待） */
const waitFor = (fn, timeout = 5000, arg) => page.waitForFunction(fn, arg, { timeout })
/** 等待 body.innerText 包含某文本 */
const waitForText = (text, timeout = 5000) =>
  waitFor((t) => document.body.innerText.includes(t), timeout, text)

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  // 初始 bootstrap：等侧边栏「新建对象」入口出现
  await page.getByRole('button', { name: '新建对象' }).first().waitFor({ timeout: 10000 })
  ok('视图栏仅三视图（无设置 Tab，R2）', (await page.getByRole('tab', { name: '设置' }).count()) === 0)

  // 1. 新建对象：首页空态 CTA（三期：无顶部「新建▾」，入口 = 侧边栏空态 CTA / 活跃对象组 +）
  ok('无顶部新建▾下拉', (await page.getByRole('button', { name: '新建', exact: true }).count()) === 0)
  await page.getByRole('button', { name: '新建对象' }).first().click()
  await page.getByLabel('标题').fill('UI 冒烟测试对象')
  await page.getByPlaceholder('作者 / 演讲者 / 维护者').fill('测试作者')
  await page.getByRole('button', { name: '创建' }).click()
  // 对象详情：唯一顶栏（标题 + 笔记数 + 新笔记），无重复标题行
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  const detailText = await page.evaluate(() => document.body.innerText)
  ok('对象详情顶栏出现（标题+笔记数）', detailText.includes('UI 冒烟测试对象') && detailText.includes('笔记 · 0'))
  ok('对象详情顶栏有新笔记按钮', (await page.getByRole('button', { name: /新笔记/ }).count()) >= 1)
  // AC5：对象级操作已收敛到右键，顶栏无归档/编辑/删除 icon
  ok('AC5：顶栏无归档/编辑/删除 icon',
    (await page.getByRole('button', { name: '归档对象' }).count()) === 0 &&
    (await page.getByRole('button', { name: '编辑对象' }).count()) === 0 &&
    (await page.getByRole('button', { name: '删除对象' }).count()) === 0)
  // AC5：ℹ 元数据查看（Popover）
  ok('AC5：ℹ 元数据按钮出现', (await page.getByRole('button', { name: '查看元数据' }).count()) === 1)
  await page.getByRole('button', { name: '查看元数据' }).click()
  await waitForText('测试作者')
  ok('AC5：ℹ Popover 显示元数据',
    (await page.evaluate(() => document.body.innerText)).includes('测试作者'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 1b. 首页侧边栏：活跃对象分组出现对象（三期：无「钉住对象」分组）
  const sidebarText = await page.locator('aside').innerText()
  ok('首页侧边栏「活跃对象」分组', sidebarText.includes('活跃对象') && sidebarText.includes('UI 冒烟测试对象'))

  // 2. 新建笔记：Dialog 小窗（仅标题+标签，无正文编辑器），保存后回列表
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('冒烟笔记')
  const hasBodyEditor = await page.evaluate(() => !!document.querySelector('.milkdown'))
  ok('新建笔记无正文编辑器（快速创建）', !hasBodyEditor)
  // AC9：标签联想（点击输入框 → 输入字符 → 弹层出现，含「创建标签」候选）
  const tagInput = page.locator('input[placeholder*="输入标签名"]')
  await tagInput.click()
  await tagInput.type('深度')
  await page.locator('[data-slot="command-item"]').first().waitFor()
  ok('AC9：标签联想弹层出现（创建标签候选）',
    (await page.locator('[data-slot="command-item"]').count()) >= 1)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByText('冒烟笔记').first().waitFor()
  ok('笔记卡片出现', (await page.evaluate(() => document.body.innerText)).includes('冒烟笔记'))

  // 3. 点卡片 → 详情 WYSIWYG 编辑器（Milkdown/Crepe，空正文直接可写）
  //    dispatchEvent 派发 click（规避 dev 环境偶发 hit-test 拦截）
  await page.locator('[role="button"]', { hasText: '冒烟笔记' }).first().dispatchEvent('click')
  await page.locator('.milkdown .ProseMirror').first().waitFor({ timeout: 10000 })
  await page.locator('.milkdown .ProseMirror').first().click()
  await page.keyboard.type('# 标题\n- 列表项一\n- 列表项二')
  await waitFor(() => !!document.querySelector('.milkdown h1') &&
    (document.querySelectorAll('.milkdown li').length ?? 0) >= 2)
  ok('WYSIWYG：标题 h1 渲染', (await page.locator('.milkdown h1').count()) >= 1)
  ok('WYSIWYG：无序列表渲染', (await page.locator('.milkdown li').count()) >= 2)

  // 3b. 快捷工具栏：点击「勾选框」插入任务列表
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '勾选框' }).click()
  await page.keyboard.type('待办项')
  await waitFor(() => document.querySelectorAll('.milkdown-list-item-block .label').length >= 1)
  ok('快捷工具栏：勾选框插入', (await page.locator('.milkdown-list-item-block .label').count()) >= 1)

  // 3c. 代码块：Typora 式独立输入区（Crepe code-block，语言选择器为浮层按钮）
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '代码块', exact: true }).click()
  await page.locator('.milkdown-code-block').last().waitFor()
  await page.locator('.milkdown-code-block .cm-content').first().click()
  await page.keyboard.type('const editorProbe = true')
  await waitFor(() => document.querySelector('.milkdown-code-block')?.textContent?.includes('const editorProbe = true'))
  ok('代码块：插入后出现独立输入区', (await page.locator('.milkdown-code-block').count()) >= 1)
  ok('代码块：连续输入同步（无围栏可见）',
    await page.evaluate(() => {
      const block = document.querySelector('.milkdown-code-block')
      return !!block && !(block.innerText ?? '').includes('```')
    }))
  const langBtn = page.locator('.milkdown-code-block .language-button').last()
  await langBtn.click()
  await page.locator('.milkdown-code-block input[placeholder*="Search"]').last().waitFor({ timeout: 3000 }).catch(() => {})
  ok('代码块：语言选择器浮层可展开', (await page.locator('.milkdown-code-block input[placeholder*="Search"]').count()) >= 1)
  await page.keyboard.press('Escape')

  // 3d. 表格：Crepe GFM 表格（直接编辑单元格）
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '表格', exact: true }).click()
  await page.locator('.milkdown table').last().waitFor()
  ok('表格：插入后出现真实 table', (await page.locator('.milkdown table').count()) >= 1)
  await page.locator('.milkdown table td').first().click()
  await page.keyboard.type('单元格编辑')
  await waitFor(() => document.querySelector('.milkdown table td')?.textContent?.includes('单元格编辑'))
  ok('表格：单元格可直接编辑', true)
  // 实时保存：无「保存正文」按钮；防抖 500ms 落盘 → 固定 900ms 余量
  await page.waitForTimeout(900)
  ok('无保存正文按钮', (await page.getByRole('button', { name: /保存正文/ }).count()) === 0)

  // 4. 返回 → 重开笔记：正文已自动落盘（实时保存链路，重开仍在编辑器）
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByText('冒烟笔记').first().waitFor()
  await page.locator('[role="button"]', { hasText: '冒烟笔记' }).first().dispatchEvent('click')
  await page.locator('.milkdown .ProseMirror').first().waitFor({ timeout: 10000 })
  const persisted = await page.evaluate(() => ({
    text: document.querySelector('.milkdown')?.textContent ?? '',
    table: document.querySelectorAll('.milkdown table').length,
    code: document.querySelectorAll('.milkdown-code-block').length,
    editedCell: [...document.querySelectorAll('.milkdown table td')].some((cell) => cell.textContent?.includes('单元格编辑')),
  }))
  ok('实时保存：重开后正文仍在（未手动保存）',
    persisted.text.includes('列表项一') && persisted.text.includes('待办项'))
  ok('编辑器：代码块/表格状态可持久化', persisted.table >= 1 && persisted.code >= 1 && persisted.editedCell)
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('tab', { name: '首页' }).click()
  await page.locator('aside').getByText('UI 冒烟测试对象').first().waitFor()
  ok('首页活跃列表出现对象', await page.locator('aside').getByText('UI 冒烟测试对象').first().isVisible())

  // 4b. AC12：800×600 无横向滚动
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }))
  ok('AC12：800×600 无横向滚动', overflow.sw <= overflow.cw)

  // 5. 对象行右键菜单（AC3）：编辑/归档/删除 出现
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click({ button: 'right' })
  await page.locator('[role="menu"]').waitFor()
  const menuText = await page.locator('[role="menu"]').innerText()
  ok('AC3：右键菜单含 编辑/归档/删除',
    menuText.includes('编辑') && menuText.includes('归档') && menuText.includes('删除'))
  await page.keyboard.press('Escape')
  await page.locator('[role="menu"]').waitFor({ state: 'detached' })

  // 6. 归档流程（AC1/AC2/AC6）：右键归档 → 归档视图只读 → 右键恢复直回首页
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click({ button: 'right' })
  await page.locator('[role="menu"]').waitFor()
  await page.locator('[role="menu"]').getByText('归档').click()
  const archiveDialog = page.getByRole('alertdialog')
  await archiveDialog.waitFor()
  ok('AC1：归档确认框提示笔记转只读', (await archiveDialog.innerText()).includes('1 条笔记将一并转为只读'))
  await archiveDialog.getByRole('button', { name: '归档', exact: true }).click()
  await waitForText('已归档')
  ok('归档成功提示', (await page.evaluate(() => document.body.innerText)).includes('已归档'))
  // 首页活跃列表消失
  await page.getByRole('tab', { name: '首页' }).click()
  await waitFor(() => document.querySelectorAll('aside').length > 0 &&
    !document.querySelector('aside')?.textContent?.includes('UI 冒烟测试对象'))
  ok('AC1：归档后首页活跃列表消失', (await page.locator('aside').getByText('UI 冒烟测试对象').count()) === 0)
  // 归档视图：对象出现 → 只读详情
  await page.getByRole('tab', { name: '归档' }).click()
  await page.locator('aside').getByText('UI 冒烟测试对象').first().waitFor()
  ok('归档侧边栏出现对象', await page.locator('aside').getByText('UI 冒烟测试对象').first().isVisible())
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await waitForText('已归档（只读）')
  const archivedDetail = await page.evaluate(() => document.body.innerText)
  ok('AC2：归档详情只读（无新笔记/恢复，有已归档+ℹ）',
    archivedDetail.includes('已归档（只读）') &&
    (await page.getByRole('button', { name: /新笔记/ }).count()) === 0 &&
    (await page.getByRole('button', { name: '恢复', exact: true }).count()) === 0 &&
    (await page.getByRole('button', { name: '查看元数据' }).count()) === 1)
  // 归档笔记 → 只读 NoteView（无正文编辑器）
  await page.getByText('冒烟笔记').first().click()
  await waitForText('已归档（只读）')
  const archivedNote = await page.evaluate(() => document.body.innerText)
  const readOnlyNoEditor = await page.evaluate(
    () => {
      const pm = document.querySelector('.milkdown .ProseMirror')
      return !pm || pm.getAttribute('contenteditable') === 'false'
    },
  )
  ok('归档笔记只读 NoteView（Crepe readonly）', archivedNote.includes('已归档（只读）') && readOnlyNoEditor)
  // 归档视图对象行右键 = 恢复/删除
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click({ button: 'right' })
  await page.locator('[role="menu"]').waitFor()
  const archivedMenu = await page.locator('[role="menu"]').innerText()
  ok('AC6：归档行右键含 恢复/删除',
    archivedMenu.includes('恢复') && archivedMenu.includes('删除') && !archivedMenu.includes('编辑'))
  await page.keyboard.press('Escape')
  await page.locator('[role="menu"]').waitFor({ state: 'detached' })
  // 恢复（右键菜单）→ 立即回首页活跃列表（AC7：无需重新钉住）
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click({ button: 'right' })
  await page.locator('[role="menu"]').waitFor()
  await page.locator('[role="menu"]').getByText('恢复', { exact: true }).click()
  await page.getByRole('alertdialog').waitFor()
  await page.getByRole('alertdialog').getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('tab', { name: '首页' }).click()
  await page.locator('aside').getByText('UI 冒烟测试对象').first().waitFor()
  ok('AC7：恢复后立即出现在首页活跃列表',
    await page.locator('aside').getByText('UI 冒烟测试对象').first().isVisible())

  // 7. 设置流程（AC4/AC5/AC6）：新增类型 → 下拉生效 → 删除（引用计数）→ 偏好
  // 设置入口 = 侧边栏底部齿轮（R3）；设置视图侧边栏回显浏览视图（非空）
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByLabel('新类型名称').waitFor()
  ok('AC3：设置视图侧边栏非空（回显归档列表）',
    (await page.locator('aside').innerText()).includes('UI 冒烟测试对象'))
  await page.getByLabel('新类型名称').fill('播客')
  await page.getByRole('button', { name: '添加' }).click()
  await waitForText('播客')
  ok('新增类型出现', (await page.evaluate(() => document.body.innerText)).includes('播客'))
  // AC4：新建对象来源下拉立即出现「播客」（入口 = 首页活跃对象组 +）
  await page.getByRole('tab', { name: '首页' }).click()
  await page.getByRole('button', { name: '新建对象' }).first().waitFor()
  await page.getByRole('button', { name: '新建对象' }).first().click()
  await page.getByLabel('来源类型').click()
  await page.getByRole('option', { name: '播客' }).waitFor()
  const hasPodcastOption = await page.getByRole('option', { name: '播客' }).count()
  ok('AC10：对象表单无标签输入', (await page.getByLabel('标签').count()) === 0)
  await page.getByRole('option', { name: '播客' }).click()
  await page.getByLabel('标题').fill('播客对象')
  await page.getByRole('button', { name: '创建' }).click()
  await waitForText('播客')
  ok('AC4：来源下拉即时出现「播客」且可创建对象', hasPodcastOption === 1 &&
    (await page.evaluate(() => document.body.innerText)).includes('播客'))
  // AC5：删除被引用类型 → 确认含引用计数 → 删除后消失
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: '删除 播客' }).waitFor()
  await page.getByRole('button', { name: '删除 播客' }).click()
  const delDialog = page.getByRole('alertdialog')
  await delDialog.waitFor()
  ok('AC5：删除确认含引用计数', (await delDialog.innerText()).includes('1 个对象使用该类型'))
  await delDialog.getByRole('button', { name: '删除', exact: true }).click()
  await waitFor(() => document.querySelectorAll('[aria-label="删除 播客"]').length === 0)
  ok('AC5：删除后类型消失',
    (await page.getByRole('button', { name: '删除 播客' }).count()) === 0)
  // AC6：偏好默认排序 → 创建时间（保存提示）
  await page.getByLabel('默认排序').click()
  await page.getByRole('option', { name: '创建时间' }).click()
  await waitForText('偏好已保存')
  ok('AC6：偏好保存提示', (await page.evaluate(() => document.body.innerText)).includes('偏好已保存'))

  // 7b. 搜索态（S1 回归：顶栏与 ContentArea 优先级一致 + relevance + 来源筛选）
  await page.getByRole('tab', { name: '首页' }).click()
  await page.locator('aside').getByText('UI 冒烟测试对象').first().waitFor()
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  await page.evaluate(() => window.__snDebug.setSearch('冒烟'))
  await waitForText('搜索结果')
  ok('搜索态顶栏：搜索结果 + 无对象操作区',
    (await page.evaluate(() => document.body.innerText)).includes('搜索结果') &&
    (await page.getByRole('button', { name: /新笔记/ }).count()) === 0)
  ok('搜索态来源筛选出现', (await page.getByLabel('来源类型筛选').count()) === 1)
  await page.getByRole('button', { name: '排序' }).click()
  await page.locator('[role="menuitemradio"]').filter({ hasText: '相关度' }).waitFor()
  ok('搜索态排序含相关度', (await page.locator('[role="menuitemradio"]').filter({ hasText: '相关度' }).count()) === 1)
  await page.keyboard.press('Escape')
  await page.locator('[role="menu"]').waitFor({ state: 'detached' })
  await page.evaluate(() => window.__snDebug.setSearch(''))
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  ok('退出搜索回对象详情顶栏', (await page.getByRole('button', { name: /新笔记/ }).count()) === 1)

  // 8. 实时保存全流程（进入即编辑、无草稿、无确认框、重进持久化）
  await page.getByRole('tab', { name: '首页' }).click()
  await page.locator('aside').getByText('UI 冒烟测试对象').first().waitFor()
  await page.locator('aside').getByText('UI 冒烟测试对象').first().click()
  await page.getByText('冒烟笔记').first().waitFor()
  await page.getByText('冒烟笔记').first().click()
  await page.locator('.milkdown .ProseMirror').first().waitFor()
  // AC9：NoteView 顶栏（返回按钮所在行）无对象名，只有笔记自身信息
  const noteHeaderText = await page
    .getByRole('button', { name: /返回/ })
    .first()
    .locator('xpath=..')
    .innerText()
  ok('AC9：笔记详情顶栏无对象名',
    !noteHeaderText.includes('UI 冒烟测试对象') && noteHeaderText.includes('冒烟笔记'))
  // 进入笔记后顶部对象栏整体隐藏（ContentHeader 不渲染）
  ok('进入笔记后对象栏隐藏（无新笔记按钮）',
    (await page.getByRole('button', { name: /新笔记/ }).count()) === 0)
  // 实时保存时代：无「写正文」按钮（已进入编辑态）、无 localStorage 草稿、切走无确认框
  await page.locator('.milkdown .ProseMirror').first().click()
  await page.keyboard.type('\n实时保存测试')
  await page.waitForTimeout(900) // 防抖 500ms 落盘 → 固定 900ms 余量
  const draftKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('sn:draft:')),
  )
  ok('实时保存：无 localStorage 草稿残留', draftKeys.length === 0)
  // 返回 → 无确认框（DirtyGuard 已删），直接退出
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByText('冒烟笔记').first().waitFor()
  ok('实时保存：切走无确认框', (await page.getByRole('alertdialog').count()) === 0)
  // 重进笔记：正文已自动落盘（持久化验证）
  await page.getByText('冒烟笔记').first().click()
  await page.locator('.milkdown .ProseMirror').first().waitFor()
  const reenterText = await page.evaluate(
    () => document.querySelector('.milkdown')?.textContent ?? '',
  )
  ok('实时保存：重进正文仍在（未手动保存）', reenterText.includes('实时保存测试'))

  // 9. 空正文笔记（可写即所见）实时保存
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('空正文草稿')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByText('空正文草稿').first().waitFor()
  await page.getByText('空正文草稿').first().click()
  await page.locator('.milkdown .ProseMirror').first().waitFor()
  ok('空正文笔记直接进入编辑器', await page.evaluate(() => !!document.querySelector('.milkdown')))
  await page.locator('.milkdown .ProseMirror').first().click()
  await page.keyboard.type('空正文草稿内容')
  await page.waitForTimeout(900) // 防抖 500ms 落盘 → 固定 900ms 余量
  const emptyDraftKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('sn:draft:')),
  )
  ok('空正文编辑也无草稿（实时落盘）', emptyDraftKeys.length === 0)
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  ok('空正文编辑切走无确认框', (await page.getByRole('alertdialog').count()) === 0)

  // 10. AC3 右键删除执行（级联）：删除「播客对象」
  await page.getByRole('tab', { name: '首页' }).click()
  await page.locator('aside').getByText('播客对象').first().waitFor()
  await page.locator('aside').getByText('播客对象').first().click({ button: 'right' })
  await page.locator('[role="menu"]').waitFor()
  await page.locator('[role="menu"]').getByText('删除').click()
  await page.getByRole('alertdialog').waitFor()
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click()
  await waitFor(() => !document.querySelector('aside')?.textContent?.includes('播客对象'))
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


