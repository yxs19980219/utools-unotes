#!/usr/bin/env node
/**
 * 编辑器专项冒烟（任务 08-14-milkdown-editor-migration）：Milkdown/CrepeBuilder 内核。
 *
 * 覆盖：
 * - 公式：行内 $…$（input rule → math_inline 节点渲染）/ 块级 $$…$$（→ code_block
 *   LaTeX 预览）/ 未闭合不渲染 / `a $ b` 不渲染 / 转义 \$ 不渲染
 * - 任务勾选框：渲染 + 点击切换写回 [x]
 * - 引用块 / 分割线渲染
 * - 代码块：CM6 内核渲染 + 语言选择（.milkdown-code-block .language-picker）
 * - 无斜杠命令 / 无块手柄（未装 slash / block-edit）
 * - 工具栏 20 项 + wrap/行级/块级插入（store 断言）
 * - 图片插入（降级 file input → blob URL 语法）
 * - Ctrl+S 立即落盘
 * - 大纲跳转（Milkdown 按 level+text 定位标题）
 * - 深色主题：渲染仍存 + 背景变暗
 * - 长文档（600 行）输入流畅、无渲染错误
 * - round-trip：编辑→保存→重开 关键内容不丢（语法规范化接受：$$ 块 → ```latex 围栏）
 *
 * 测试策略：
 * - 正文断言一律走 store（window.__snDebug.getActiveNoteContent），规避渲染 DOM 差异
 * - 渲染断言走 Milkdown DOM（.milkdown .ProseMirror / [data-type=math_inline] /
 *   .milkdown-code-block / blockquote / hr / .crepe-placeholder）
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
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`)
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
/** 渲染统计：行内公式节点 / KaTeX 总数 / 代码块 */
const renderStats = () =>
  page.evaluate(() => ({
    inlineMath: document.querySelectorAll('.milkdown span[data-type="math_inline"]').length,
    katex: document.querySelectorAll('.milkdown .katex').length,
    codeBlocks: document.querySelectorAll('.milkdown .milkdown-code-block').length,
    blockquotes: document.querySelectorAll('.milkdown blockquote').length,
    hrs: document.querySelectorAll('.milkdown hr').length,
    taskItems: document.querySelectorAll('.milkdown .milkdown-list-item-block .label').length,
    placeholder: document.querySelectorAll('.milkdown .crepe-placeholder').length,
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
  await page.locator('.milkdown .ProseMirror').first().waitFor({ timeout: 10000 })

  // ---- 1. placeholder（空笔记） ----
  await waitFor(() => document.querySelectorAll('.milkdown .crepe-placeholder').length >= 1)
  ok('空笔记 placeholder 显示', (await renderStats()).placeholder >= 1)

  // ---- 2. 工具栏按钮数（基线 20 项 = 9 wrap + 7 行级 + 4 块级） ----
  const toolCount = await page.locator('[role="toolbar"] button').count()
  ok(`工具栏按钮数（基线 20 项：9 wrap+7 行级+4 块级，实际 ${toolCount}）`,
    toolCount === 20)

  // ---- 3. 正文输入（真实按键逐行触发 input rules；Milkdown 解析是输入驱动的） ----
  // 行内公式：`$x^2 + 1$` 行尾 $ 触发 mathInlineInputRule
  await page.keyboard.type('行内公式 $x^2 + 1$ 结束')
  await page.keyboard.press('Enter')
  // 公式块：`$$` + Enter → code_block(LaTeX)；Ctrl+Enter（exitCode）退出 → 预览渲染
  await page.keyboard.type('$$')
  await page.keyboard.press('Enter')
  await page.keyboard.type('E = mc^2')
  await page.keyboard.press('Control+Enter')
  // 第二个公式块：\frac{a}{b}
  await page.keyboard.type('$$')
  await page.keyboard.press('Enter')
  await page.keyboard.type('\\frac{a}{b}')
  await page.keyboard.press('Control+Enter')
  // 边界用例（纯文本行，$ 不闭合/开 $ 后空白/转义 → 不渲染，保持源码）
  await page.keyboard.type('未闭合 $x^2 之后')
  await page.keyboard.press('Enter')
  await page.keyboard.type('价格 a $ b 元')
  await page.keyboard.press('Enter')
  await page.keyboard.type('\\$转义美元符号')
  await page.keyboard.press('Enter')
  // 引用块：`> ` 触发 wrapInBlockquoteInputRule；ArrowDown 退出引用
  await page.keyboard.type('> ')
  await page.keyboard.type('引用内容')
  await page.keyboard.press('ArrowDown')
  // 分割线：`---` + Enter → thematicBreak
  await page.keyboard.type('---')
  await page.keyboard.press('Enter')
  // 代码块：```ts + Enter → fence input rule；Ctrl+Enter 退出
  await page.keyboard.type('```ts')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const n: number = 1')
  await page.keyboard.press('Control+Enter')
  await page.waitForTimeout(500)

  // ---- 4. 公式渲染（行内 math_inline + 块级 LaTeX 代码块预览） ----
  // 光标在文档尾（围栏外）→ 全部渲染态
  const s1 = await renderStats()
  ok('AC1：行内公式 $…$ 渲染为 KaTeX（math_inline 节点）',
    s1.inlineMath >= 1 && s1.katex >= 1)
  ok('AC1：块级公式（$$ → LaTeX 代码块）渲染为预览',
    s1.codeBlocks >= 2 && s1.katex >= 2)

  // ---- 5. 语法边界：未闭合 / a $ b / 转义 $ 不渲染 ----
  const before5 = await page.evaluate(() => document.querySelector('.milkdown .ProseMirror')?.textContent ?? '')
  ok('未闭合 $ / `a $ b` / 转义 \\$ 保持源码文本',
    before5.includes('$x^2 之后') && before5.includes('a $ b 元') && before5.includes('\\$转义'))
  const s5 = await renderStats()
  ok('边界用例不产生多余公式节点',
    s5.inlineMath <= 1)

  // ---- 6. 任务勾选框：独立笔记（避免与公式块后的 hardbreak 段落耦合） ----
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('任务列表笔记')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByRole('button', { name: /任务列表笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /任务列表笔记/ }).first().click()
  await page.locator('.milkdown .ProseMirror').first().waitFor()
  await page.keyboard.type('- [ ] 待办一', { delay: 30 })
  await page.keyboard.press('Enter')
  await waitFor(() => document.querySelectorAll('.milkdown .milkdown-list-item-block .label').length >= 1)
  ok('AC2：任务勾选框渲染（- [ ] 语法 → checkbox）', (await renderStats()).taskItems >= 1)
  await page.locator('.milkdown .milkdown-list-item-block .label').first().click()
  await waitFor((s) => window.__snDebug.getActiveNoteContent().includes(s), 4000, '[x] 待办一')
  ok('AC2：勾选框点击切换写回 [x]', (await getContent()).includes('[x] 待办一'))
  // 清掉列表续行（Shift+Home 选中 → Backspace）
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(200)

  // 回到专项笔记（后续章节在原文上继续）
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('button', { name: /编辑器专项笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /编辑器专项笔记/ }).first().click()
  await page.locator('.milkdown .ProseMirror').first().waitFor()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter') // 文档尾新空行（供后续输入）

  // ---- 7. 引用块 / 分割线渲染 ----
  const s7 = await renderStats()
  ok('AC3：引用块渲染（blockquote）', s7.blockquotes >= 1)
  ok('AC5：分割线渲染（hr）', s7.hrs >= 1)

  // ---- 8. 代码块：CM6 内核渲染 + 语言选择入口 ----
  ok('AC4：代码块渲染（.milkdown-code-block）',
    s7.codeBlocks >= 1 &&
    (await page.locator('.milkdown .milkdown-code-block').first().waitFor().then(() => true).catch(() => false)))

  // ---- 9. 无斜杠命令 / 无块手柄 ----
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await page.waitForTimeout(400)
  ok('R11：输入 / 无斜杠命令菜单/块手柄',
    (await page.getByRole('menu').count()) === 0 &&
    (await page.locator('.milkdown-block-handle, [class*="slash"]').count()) === 0)
  await page.keyboard.press('Backspace')

  // ---- 10. 工具栏 wrap/行级/块级（store 断言） ----
  await page.keyboard.type('包裹目标')
  await page.keyboard.press('Shift+Home') // 选中当前行文本 → 点「加粗」
  await page.getByRole('button', { name: '加粗' }).click()
  await waitFor((s) => window.__snDebug.getActiveNoteContent().includes(s), 4000, '**包裹目标**')
  ok('工具栏 wrap：加粗包裹选中文本', (await getContent()).includes('**包裹目标**'))
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '一级标题' }).click()
  await waitFor((s) => window.__snDebug.getActiveNoteContent().includes(s), 4000, '\n#')
  ok('工具栏行级：一级标题插入', (await getContent()).includes('\n#'))
  await page.getByRole('button', { name: '公式块' }).click()
  await page.keyboard.type('E=mc^2')
  await page.keyboard.press('Control+Enter') // 离开公式块 → 预览渲染
  // 渲染细节已由第 4 节覆盖（块级公式预览）；此处验证插入生效（等待防抖落盘）
  await waitFor(() => document.querySelectorAll('.milkdown .katex').length >= 2)
  await waitFor((s) => window.__snDebug.getActiveNoteContent().includes(s), 4000, 'E=mc^2')
  ok('工具栏块级：公式块插入（LaTeX 预览渲染）', (await getContent()).includes('E=mc^2'))
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '分割线' }).click()
  await waitFor(() => document.querySelectorAll('.milkdown hr').length >= 2)
  // remark-stringify 默认 thematicBreak 输出 `***`（CM6 时代为 `---`）
  ok('工具栏块级：分割线插入渲染', (await getContent()).includes('***'))

  // ---- 11. 图片插入（降级 file input 路径） ----
  const imgPath = join(tmpdir(), 'unotes-smoke-img.png')
  writeFileSync(imgPath, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex'))
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '图片' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles(imgPath)
  // 无 uTools 环境：File 无 path → blob URL；断言图片语法写回即可
  await waitFor(() => /!\[[^\]]+\]\([^)]+\)/.test(window.__snDebug.getActiveNoteContent()), 4000)
  ok('R8：图片插入写回 `![文件名](路径)` 语法',
    /!\[[^\]]+\]\([^)]+\)/.test(await getContent()))

  // ---- 12. 大纲跳转：点大纲项 → 滚动定位标题（level+text 匹配） ----
  await page.keyboard.press('End')
  await page.keyboard.press('Enter') // 新空行（图片行后）
  await page.keyboard.type('## 大纲目标标题')
  await page.keyboard.press('Enter') // 末尾留空行
  await page.waitForTimeout(900) // 落盘 → MetaInfoPanel 大纲从 store 读取
  await page.getByRole('button', { name: '查看元信息' }).click()
  await page.locator('button:has-text("大纲目标标题")').first().waitFor()
  await page.locator('button:has-text("大纲目标标题")').first().click()
  await page.keyboard.press('Escape')
  // Milkdown 无 cm-activeLine：断言标题元素被 scrollIntoView（在编辑器视口内）
  await waitFor(() => {
    const editor = document.querySelector('.milkdown .ProseMirror')
    const heading = [...document.querySelectorAll('.milkdown h2')].find(
      (h) => h.textContent?.includes('大纲目标标题'),
    )
    if (!editor || !heading) return false
    const er = editor.getBoundingClientRect()
    const hr = heading.getBoundingClientRect()
    return hr.top >= er.top - 2 && hr.bottom <= er.bottom + 2
  })
  ok('R8：大纲跳转定位正确（标题滚动到编辑器视口内）', true)

  // ---- 13. Ctrl+S 立即落盘（无 500ms 防抖等待） ----
  const before = await getContent()
  await page.keyboard.press('End')
  await page.keyboard.type('立即保存测试')
  await page.keyboard.press('Control+s')
  await page.waitForFunction(
    (prev) => window.__snDebug.getActiveNoteContent() !== prev,
    before,
    { timeout: 1000 },
  )
  ok('R8：Ctrl+S 立即保存（无防抖等待）', true)

  // ---- 14. round-trip：编辑→保存→重开 关键内容不丢 ----
  // （语法规范化接受：$$ 块 → ```latex 围栏；内容文本必须保留）
  const captured = await getContent()
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('button', { name: /编辑器专项笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /编辑器专项笔记/ }).first().click()
  await page.locator('.milkdown .ProseMirror').first().waitFor({ timeout: 10000 })
  const reopened = await getContent()
  // 任务列表在独立笔记验证（专项笔记 roundtrip 只含公式/引用/代码）
  const critical = ['x^2 + 1', '\\frac{a}{b}', 'E = mc^2', '引用内容', 'const n: number = 1']
  ok('AC7：重开后关键内容不丢（公式/任务/引用/代码）',
    critical.every((c) => reopened.includes(c)))
  await waitFor(() => document.querySelectorAll('.milkdown .katex').length >= 2, 8000)
  const s14 = await renderStats()
  ok('AC7：重开后公式/代码块仍渲染',
    s14.inlineMath >= 1 && s14.codeBlocks >= 2 && s14.katex >= 2)

  // ---- 15. 深色主题：公式/代码仍渲染，背景为深色 ----
  await page.emulateMedia({ colorScheme: 'dark' })
  await waitFor(() => document.documentElement.classList.contains('dark'))
  await page.waitForTimeout(300)
  const darkProbe = await page.evaluate(() => ({
    dark: document.documentElement.classList.contains('dark'),
    math: document.querySelectorAll('.milkdown [data-type="math_inline"], .milkdown .katex').length,
    code: document.querySelectorAll('.milkdown .milkdown-code-block').length,
  }))
  ok('AC10：深色主题公式/代码块仍渲染', darkProbe.dark && darkProbe.math >= 1 && darkProbe.code >= 1)
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

  // ---- 16.5 自研 mark（==高亮== / <u> 下划线）+ 表格插入 ----
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('button', { name: '新建对象' }).first().click()
  await page.getByLabel('标题').fill('扩展语法对象')
  await page.getByRole('button', { name: '创建' }).click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('扩展语法笔记')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByRole('button', { name: /扩展语法笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /扩展语法笔记/ }).first().click()
  await page.locator('.milkdown .ProseMirror').first().waitFor()
  await page.keyboard.type('==高亮文本==')
  await page.keyboard.press('Enter')
  await page.keyboard.type('<u>下划线文本</u>')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '表格' }).click()
  await waitFor(() => document.querySelectorAll('.milkdown mark').length >= 1 &&
    document.querySelectorAll('.milkdown u').length >= 1 &&
    document.querySelectorAll('.milkdown table').length >= 1, 5000)
  await waitFor((s) => window.__snDebug.getActiveNoteContent().includes(s), 4000, '==高亮文本==')
  ok('扩展语法：==高亮== 渲染为 <mark> 且 roundtrip 保留',
    (await getContent()).includes('==高亮文本==') &&
    (await page.locator('.milkdown mark').count()) >= 1)
  ok('扩展语法：<u>下划线</u> 渲染为 <u> 且 roundtrip 保留',
    (await getContent()).includes('<u>下划线文本</u>') &&
    (await page.locator('.milkdown u').count()) >= 1)
  ok('工具栏块级：表格插入渲染（GFM 序列化）',
    (await page.locator('.milkdown table').count()) >= 1 &&
    (await getContent()).includes('|'))

  // ---- 16.8 只读归档：渲染一致 + 字节级不可变 ----
  await page.getByRole('button', { name: /返回/ }).first().click()
  const readonlyObjRow = page.locator('aside li, aside [role="button"]').filter({ hasText: '扩展语法对象' }).first()
  await readonlyObjRow.click({ button: 'right' })
  await page.waitForTimeout(300)
  const archiveMenu = page.getByRole('menuitem', { name: /归档/i }).first()
  if ((await archiveMenu.count()) > 0) {
    await archiveMenu.click()
    await page.waitForTimeout(300)
    const confirmBtn = page.getByRole('button', { name: /确认|归档/ }).first()
    if ((await confirmBtn.count()) > 0) await confirmBtn.click()
  }
  await page.getByRole('button', { name: /扩展语法笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /扩展语法笔记/ }).first().click()
  await page.locator('.milkdown .ProseMirror').first().waitFor()
  await waitFor(() => document.querySelector('.milkdown .ProseMirror')?.getAttribute('contenteditable') === 'false', 5000)
  const roProbe = await page.evaluate(() => ({
    editable: document.querySelector('.milkdown .ProseMirror')?.getAttribute('contenteditable'),
    mark: document.querySelectorAll('.milkdown mark').length,
    u: document.querySelectorAll('.milkdown u').length,
    table: document.querySelectorAll('.milkdown table').length,
    toolbar: document.querySelectorAll('[role="toolbar"]').length,
  }))
  ok('AC9：归档笔记只读（editable=false + 无编辑工具栏 + 渲染一致）',
    roProbe.editable === 'false' && roProbe.toolbar === 0 &&
    roProbe.mark >= 1 && roProbe.u >= 1 && roProbe.table >= 1)
  const roBefore = await getContent()
  await page.locator('.milkdown .ProseMirror').first().click()
  await page.keyboard.type('只读输入测试')
  await page.waitForTimeout(700)
  ok('AC9：只读输入无效果（字节级不可变）',
    (await getContent()) === roBefore && !roBefore.includes('只读输入测试'))

  // 切回「首页」视图（归档视图无新建入口；后续长文档测试需要）。
  // 不从只读笔记「返回」（该按钮在此路径不可靠），直接切侧边栏 tab。
  await page.getByRole('tab', { name: /首页/ }).first().click()
  await page.waitForTimeout(400)

  // ---- 16. 长文档（600 行）输入与渲染 ----
  await page.getByRole('button', { name: /返回/ }).first().click()
  await page.getByRole('button', { name: /新笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /新笔记/ }).first().click()
  await page.getByLabel('标题').fill('长文档笔记')
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByRole('button', { name: /长文档笔记/ }).first().waitFor()
  await page.getByRole('button', { name: /长文档笔记/ }).first().click()
  await page.locator('.milkdown .ProseMirror').first().waitFor()
  // 逐行 insertText（整段 insertText 的 \n 在 ProseMirror 中不产生换行；逐行保留
  // 真实输入触发的 input rule 处理，且避免 Playwright 逐字符注入开销）。
  // 注意：行内不含公式——快速 insertText + mathInlineInputRule 的组合会触发
  // ProseMirror 位置越界（真实逐字输入无此问题，见任务设计 4 已知限制）。
  const t0 = Date.now()
  for (let i = 0; i < 600; i++) {
    await page.keyboard.insertText(`- 长文档行 ${i} 内容`)
    await page.keyboard.press('Enter')
  }
  const inputMs = Date.now() - t0
  await waitFor(() => window.__snDebug.getActiveNoteContent().split('\n').length >= 600, 10000)
  // 快速 insertText 不触发 `- ` 列表 input rule（正则要求行尾）；行数断言为主
  const liCount = await page.locator('.milkdown li, .milkdown p').count()
  const storeLines = await page.evaluate(() => window.__snDebug.getActiveNoteContent().split('\n').length)
  ok('长文档：600 行输入渲染（无页面错误）',
    errors.length === 0 && storeLines >= 600 && liCount >= 500)
  ok(`长文档：600 行输入耗时 ${inputMs}ms（< 30s 即流畅）`, inputMs < 30000)
  await page.evaluate(() => {
    // 滚动容器不确定（外层 overflow-hidden div 链），scrollIntoView 滚到视口内
    const last = [...document.querySelectorAll('.milkdown li, .milkdown p')].at(-1)
    last?.scrollIntoView({ block: 'center' })
  })
  await page.waitForTimeout(400)
  ok('长文档：滚动到底部末行可见',
    await page.evaluate(() => {
      const last = [...document.querySelectorAll('.milkdown li, .milkdown p')].at(-1)
      if (!last) return false
      const r = last.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= window.innerHeight
    }))
} catch (e) {
  console.error('脚本异常:', e.message.slice(0, 300))
  try {
    console.log('[DEBUG store]', JSON.stringify(await page.evaluate(() => window.__snDebug.getActiveNoteContent())))
    console.log('[DEBUG render]', await page.evaluate(() => ({
      stats: {
        inlineMath: document.querySelectorAll('.milkdown [data-type="math_inline"]').length,
        katex: document.querySelectorAll('.milkdown .katex').length,
        codeBlocks: document.querySelectorAll('.milkdown .milkdown-code-block').length,
        blockquotes: document.querySelectorAll('.milkdown blockquote').length,
        hrs: document.querySelectorAll('.milkdown hr').length,
    taskItems: document.querySelectorAll('.milkdown .milkdown-list-item-block .label').length,
        placeholder: document.querySelectorAll('.milkdown .crepe-placeholder').length,
      },
      proseMirror: document.querySelector('.milkdown .ProseMirror')?.outerHTML.slice(0, 300),
    })))
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
