# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

质量门禁（package.json scripts）：

```bash
npm run typecheck        # tsc -b（build 也会先跑）
npm run build            # tsc -b && vite build → dist/（检查无 development 字段）
npm run smoke            # node scripts/smoke-data-layer.ts（数据层 + 搜索）
npm run smoke:stores     # node scripts/smoke-stores.ts（store 编排 + 一致性）
npm run smoke:decorations# node scripts/smoke-decorations.ts（编辑器装饰器，headless）
npm run smoke:tableModel # node scripts/smoke-tableModel.ts（Markdown 表格模型与 round-trip）
```

无 lint（未配置 ESLint）、无单测框架 —— **冒烟测试体系替代单测**：node 直测（无 uTools 环境），覆盖关键契约，跑全部通过即视为可交付。原则：不为展示层写测试（变更频繁收益低），为**数据契约与跨 store 编排**写冒烟（回归收益高）。

---

## Forbidden Patterns

- **组件/UI 层直接读写 utools.db**：数据必须经 store → services/db.ts；这是本项目最高红线
- **把搜索索引/缓存写入 db**：搜索是内存全量过滤，db 只存用户主动创建的数据（design.md 第 4 节红线）
- **不经过 store 裸改内存**：`useNotesStore.setState(...)` 直接改数组、绕过 action 编排（级联清理会漏）
- **硬编码 `_id` 前缀字符串**：用 `ID_PREFIX`（`db.ts:26`）；硬编码会导致类型守卫/前缀分类失效
- **组件里自建时间格式化 / 来源类型文案**：一律 `lib/format.ts` 的 `formatTime` 与 `lib/sourceTypes.ts` 的 `sourceTypeLabel`/`sourceTypeIcon`
- **破坏性操作无确认**：删除对象/笔记/标签必须 AlertDialog 确认（数量提示），删除对象提示级联笔记数
- **用户操作失败无反馈**：保存/创建等异步失败必须 toast 提示（`NoteForm.tsx:113` 保存失败），禁止静默吞错
- **装饰器修改文档内容**：CodeMirror 装饰只改显示，禁止在装饰器里改 doc / 拦截事务（`markdownDecorations.ts` 头部契约）
- **新增不必要依赖**：先查项目已有能力（shadcn/ui、lucide、zustand、CM6），不够再加

---

## Required Patterns

- 写操作先 db 后内存（store action 内 `await` 成功才 `set()`）
- 类型守卫是唯一收窄入口（`isNoteDoc` 等），新增文档类型必须配套守卫
- 更新必带 `_rev`（缺省由 db 层容错补齐，但显式传 rev 是默认写法）
- 破坏性/跨域操作走 store 编排（对象级联删除、标签删除引用清理），顺序：先清理引用再删本体
- 语义色 Token（禁止裸色值）、紧凑密度（h-7/h-8、text-xs）、无横向滚动（min-w-0 + truncate）
- 空态全覆盖：首页/标签/搜索无结果/对象详情/笔记全文均提供 Empty 引导
- 每个数据/服务/组件文件头部写 JSDoc 契约注释（design.md 章节引用 + 关键约束）

---

## Testing Requirements

冒烟测试体系（node 直测，`scripts/`，全部基于 MemoryDb 防御降级）：

| 脚本 | 覆盖 | 对应契约 |
|------|------|---------|
| `smoke-data-layer.ts` | schema 读写往返、_rev 冲突、`deleteObjectCascade` 级联、别名归并、`suggestTags` 联想、`findTagConflicts` 冲突、搜索语法（tokenize/type:前缀/#标签/裸词/相关度/空查询）、**AC9 归档笔记可搜**、`sortNotes` | 数据层 + 搜索 |
| `smoke-stores.ts` | bootstrap 幂等、对象 CRUD/钉住、**归档自动取消钉住（R12）**、标签删除跨域引用清理、`countNotesByTag`、对象级联删除内存同步、ui 选中互斥/编辑态、`resolveTagIds` 归并、排序/筛选持久、**搜索态排序迁移** | store 编排 |
| `smoke-decorations.ts` | 标题（光标行淡色/非光标行隐藏）、粗斜/行内代码/链接、任务复选框 Widget、引用/分隔线/代码块/列表标记 | 编辑器装饰 |

写法约定：`node:assert/strict` + 手写 `ok()` 计数，`main().catch(err => process.exit(1))` 失败即非零退出；每个脚本开头 `resetDbForTest()` 隔离数据。**新契约必须带冒烟断言**（如新增搜索语法、新增跨域编排），改动既有契约时先跑对应脚本确认未回归。
- **node 直测模块禁 `@/` 路径别名**：smoke 脚本用 `node` 直接加载被测 TS 源码（无 bundler），路径别名（`@/`）不解析；且 ESM 要求显式扩展名。被 smoke 直测的模块（如 `markdownDecorations.ts`）内部 import 必须用相对路径 + `.ts` 后缀（vite 构建侧不受影响，`@/` 仍可用）——二期曾踩：装饰器新 import 用 `@/lib/...` 导致 smoke-decorations ERR_MODULE_NOT_FOUND。
- **浏览器测试 hook 约定**：无 uTools 环境（vite dev）时 `main.tsx` 暴露 `window.__snDebug.setSearch(query)`（注入 ui store 的 setSearch），供 ui-smoke 触发搜索态断言；uTools 内不注入。新增需要测试触发的全局状态可沿用此模式。
- **ui-smoke 条件等待约定（08-12 起）**：除防抖落盘等待（计时器本质，保留固定 900ms 余量）外，一律用条件等待替代固定 `waitForTimeout`：`page.waitForFunction(fn, arg, { timeout })`（**参数顺序 fn → arg → options**，传反会静默失效）或 locator 原生自动等待（`waitFor()` / `waitForSelector` / `menu` 的 `state:'detached'`）。元素已满足时立即返回，慢机器不假失败；全套 ui-smoke 从 2min 降至 ~8s。
- **视觉验收用 DOM computed-style 断言**：模型/CI 无图场景下，视觉契约用 `getComputedStyle` 断言（背景色/边框宽/尺寸/圆角/对齐 top 值），如侧边栏底色、顶栏与视图栏等高（`offsetHeight` + `getBoundingClientRect().top` 对比）、Dialog 尺寸。不要先截图再发现看不了。
- **契约变更联动测试**：删除/修改机制（如 DirtyGuard、手动保存、入口按钮）时，实施同一阶段必须 grep 测试脚本中的相关断言并同步（`grep -n "按钮名|机制名" scripts/`）——本项目两轮都踩过：机制删了 ui-smoke/smoke-stores 断言超时。
- **临时探针脚本放项目目录**：node ESM 模块解析以脚本所在目录为基准，`/tmp` 下找不到 playwright-core；探针脚本放 `scripts/`（如 `scripts/tmp-probe.mjs`），用完即删。

---

## Code Review Checklist

- [ ] 组件无直接 services/db import（受控例外外）；写操作均经 store action
- [ ] 类型守卫收窄、无 `as any` / 裸断言、无重复 schema 定义
- [ ] 更新带 `_rev`；删除/级联编排顺序正确；破坏性操作有 AlertDialog 确认
- [ ] 派生列表 useMemo 依赖齐全；selector 返回稳定引用（无 filter 直出）
- [ ] 新状态提升判定：跨组件消费才进 store；表单草稿留在本地
- [ ] 语义色 Token、紧凑密度、min-w-0/truncate 无横向滚动
- [ ] 空态/错误提示覆盖（保存失败 toast、AC10 强提示、无结果语法提示）
- [ ] 新契约有对应冒烟断言，`npm run smoke*` + `npm run typecheck` + `npm run build` 全绿
- [ ] dist/plugin.json 无 development 字段（stripDevelopmentField 生效）

---

## Render-Layer Pitfalls（白屏/崩溃实战教训，2026-08 排查记录）

纯逻辑冒烟**测不到渲染期错误**。以下三类问题曾导致整页白屏，新增/修改组件必须检查：

1. **Radix/shadcn Provider 缺失**：`Tooltip` 必须被 `TooltipProvider` 包裹（本项目在 App 根统一包 `<TooltipProvider>`，新组件不要再单独包）。其他 Provider 类组件（Dialog、Select 等）同理自查。
2. **Zustand selector 返回新引用**：`selectNotesByObject` 这类派生数组 selector 直接传给 `useStore` 会因 getSnapshot 不稳定触发无限重渲染。**必须用 `useShallow` 包裹**：`useNotesStore(useShallow((s) => selectNotesByTag(s, tagId)))`；对象引用（`.find()` 返回值）本身稳定，无需包。
3. **短路条件 Hook**：`const a = useX() && useY()` 在 `useX()` 返回 false 时跳过 `useY`，状态翻转后 Hook 顺序错位崩溃。**禁止用 `&&`/`||`/三元连接多个 Hook 调用**，一律拆开再合并。
4. **Radix asChild 注入的事件被展示组件吞掉**：`ContextMenuTrigger asChild` 会向 children 注入 `onContextMenu`/ref，普通函数组件不透传时右键无响应（三期踩坑：SidebarRow 右键菜单不弹）。**被 asChild 包裹的展示组件必须声明并转发事件 props**（`SidebarRow` 的 `onContextMenu`），或改用非 asChild 包裹。
5. **顶栏语境优先级与内容区路由必须一致**：三期 ContentHeader 按 selectedObjectId 渲染对象操作区，但 ContentArea 路由是 activeNoteId > searchActive > selectedObjectId——搜索态下顶栏仍显示对象操作区（错乱）。**任何按选中态分层的头部/侧栏，其分支条件必须与内容区路由优先级逐条对齐**（本例：`showObjectActions = selectedObjectId && !searchActive`）。
6. **Tailwind v4 `data-active`/`data-vertical` 变体不匹配 radix 属性**：`data-active:` 编译为 `[data-active]`，但 radix 组件输出 `data-state="active"`；`data-vertical:` 编译为 `[data-vertical]`，而 radix Separator/ScrollAreaScrollbar 输出 `data-orientation="vertical"`。**shadcn v4 模板自带的这类类名全部静默失效**（tabs.tsx `data-active:bg-background` → 选中态透明、separator.tsx `data-vertical:w-px` → 分隔线 0 宽、scroll-area `data-vertical:w-2.5` → 滚动条 0 宽），表现为 computed style 透明/0 宽。修法：radix 场景用任意值变体 `data-[state=active]:` / `data-[orientation=vertical]:`；排查先 grep 构建产物 CSS 确认变体编译形态，再对不上 radix 实际输出的属性名。
7. **百分比 min-height 参照坑**：`min-height: 100%` 参照 containing block 的 **height 属性 used value**——父级 `height: auto`（仅被 min-height 撑到实际高度）时百分比无法解析（视作 0）。要让子级撑满父级，父级必须 height 可解析（如 `height: 100%` 链）。08-12 两区对半分任务：radix ScrollArea wrapper 曾 `min-height:100%` 撑到 512 但内部 `min-h-full` 仍按内容（150px），改 wrapper `height:100%` 后生效。
8. **radix ScrollArea 内容 wrapper 破坏百分比高度**：Viewport 直接子级是 radix 内联 `<div style="min-width:100%; display:table">`——display:table 把子元素包进匿名 table-cell（高度按行内容不传），且内联 style 只能被 `!important` 覆盖。需要内容撑满视口的场景：scoped CSS（如 `.sidebar-fill > [data-slot='scroll-area-viewport'] > div { display:block !important; min-width:100%; height:100% }`），内容多时溢出 wrapper 仍随 Viewport 滚动。
9. **destructive 菜单项必须是红底白字（悬停时）**：08-12 把 ContextMenuItem destructive 从 `focus:bg-destructive + focus:text-destructive-foreground`（红底白字）改成 `bg-destructive/10 + text-destructive`（淡红底红字）后用户反馈“红色遮住文字”——红字在红底上同色系淹没、整行泛红。**删除项悬停必须保持红底白字（白字在红底上对比清晰）**；dropdown-menu 与 context-menu 的 destructive variant 样式必须一致（本项目已统一），改 UI 组件库样式前先评估所有使用方（ContextMenuItem 同时服务对象行/标签行右键菜单）。
10. **hover 弹出操作区必须占位而非 display 切换**：`hidden group-hover:flex` 会让 hover 时操作按钮出现、挤压标题截断位置，用户感知为“卡片大小变化”。**操作区应常占位 + opacity 瞬时切换**（`pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100`，不加 transition），布局稳定且无动画。
11. **代码块工具栏插入必须保留内容空行**：围栏插入文本应为 `prefix + "\\n\\n" + suffix + "\\n"`，光标放在两条换行之间；若只插入一条换行，用户输入会与闭合围栏粘在同一行，后续表格/块节点将被解析进代码块。光标位于代码块开围栏行时，其他块级插入命令必须定位到 `FencedCode.to` 之后。

**渲染层验证标准**：涉及组件/布局/编辑器改动的任务，必须跑 `npm run ui-smoke`（playwright-core + 系统 Edge 无头，走 MemoryDb 验证对象→笔记→钉住→首页核心闭环 + 无 console/pageerror）。Dev server 需先启动（5173）。

---

## Release Process（发布流程，2026-08 确立）

uTools 插件发布 = **上传 dist 文件夹 / zip 到 uTools 开发者平台**（无需 upx 打包）。

发版操作序列（版本号遵循 SemVer：PATCH=fix / MINOR=feat / MAJOR=破坏性变更）：

```bash
# 1. 验证：typecheck + 全部 smoke + build 全绿
npm run typecheck && npm run smoke && npm run smoke:stores && npm run smoke:decorations && npm run build
# 2. 同步 package.json version → commit → push
# 3. 打附注 tag 并推送（tag 不随分支自动推）
git tag -a vX.Y.Z -m "<说明>" && git push origin vX.Y.Z
# 4. 打包 dist（zip 结构要求 plugin.json/logo/preload/assets 位于根，uTools 导入即用）
cd dist && powershell -Command "Compress-Archive -Path '*' -DestinationPath '../SourceNote-vX.Y.Z.zip' -Force" && cd ..
# 5. 创建 GitHub Release（描述用 --notes-file，附 zip 资产）
#    --title 必须用仓库名格式（utools-unotes vX.Y.Z），不用产品名 SourceNote；
#    notes 文件首行不要写 # 标题（与 --title 重复显示两次，2026-08 踩过）
gh release create vX.Y.Z SourceNote-vX.Y.Z.zip --title "utools-unotes vX.Y.Z" --notes-file <file>
# 6. 上架：uTools 开发者平台上传 zip
```

约定：
- **zip 不进仓库**（.gitignore 已含 `SourceNote-*.zip`），用完即删，需要时从 Release 下载
- **Release 标题与仓库名一致**（`utools-unotes vX.Y.Z`），**禁止用产品名 SourceNote**——README 标题也统一为 `# utools-unotes`（用户曾反馈页面又变成 sourcenote）；tag 用 `v` + SemVer
- **commit message 禁止带版本号**（用户 08-14 明确要求）：版本号只通过 git tag（`vX.Y.Z`）与 GitHub Release 承载；版本 bump 仍写入 package.json / package-lock.json
- **release notes 文件不以 `#` 标题开头**：GitHub Release 页会同时显示 --title 与 notes 内容，文件内再写标题会出现版号/内容重复
- git 身份：仓库级 `git config user.email`（当前 1902283142@qq.com）
- 只改代码不涉及功能变更的推送（如 README/docs）不需要改版本号

---

## Workflow Conventions（工作方式约定，2026-08 复盘沉淀）

SourceNote 绿地图开发（1 次规划 + 5 轮子代理 + 5 轮用户反馈修正）暴露的 4 条流程教训：

1. **规划期对齐到「按钮级」**：涉及表单/交互的功能，规划时必须把交互流程逐项列给用户确认（点哪里 → 看到什么 → 下一步去哪）。只对齐布局图不够——本项目笔记表单（归属对象选择+正文编辑器）按 PRD 实现后，用户反馈"快速创建不需要这些"，需求漂移成本 = 整个 NoteForm + NoteView 重构。
2. **主会话阶段验收**：每轮实现子代理返回后，主会话必须抽查关键组件的行为代码（不只跑测试）——本项目未抽查 NoteForm，流程偏差跨 3 轮才暴露。
3. **渲染层验证进门禁**：涉及组件/布局/编辑器改动的任务必须跑 `npm run ui-smoke`（详见 Render-Layer Pitfalls 节）。白屏三连（TooltipProvider 缺失 / useShallow 引用不稳定 / 短路条件 Hook）全部由真实 DOM 验证才捕获。
4. **uTools 内核 CSS 兼容**：现代 CSS（Tailwind 4 输出 oklch/lab/color-mix）在老内核上整段失效 → 线框。必须配置 Lightning CSS 降级（vite `css.transformer: 'lightningcss'` + `targets: { chrome: 88 }` + `build.cssMinify: false`）。详见 utools-dev skill「uTools 内核 CSS 兼容」节。
5. **需求选项空间给全**：brainstorm 给方案时，除推荐方案外必须列出「移除/按需/不显示」类选项——08-12 元数据展示只给了 A/B 两个常驻方案，用户第二轮推翻（"还是很丑"）改按需 ℹ 按钮，整个方案 B 作废。用户直觉常落在"少即是多"一侧。
6. **大段 JSX 替换先 read 当前文件**：edit 的 oldText 必须与磁盘逐字节一致；import 段被前置修改后，按旧内容拼整段替换会失败。>30 行的替换一律先 `read` 确认现状再分段 edit（本次 ContentHeader 整段替换失败一次）。**一次 edit 调用含多个 edits 时，某块不匹配会静默跳过，返回只报实际替换数——必须核对返回的 block 数与预期一致**（ViewSwitcher 双 edits 曾只替换 1 块，import 换了但 JSX 没换，typecheck 报未使用导入才暴露）。
7. **index.css 颜色变量双写坑（hex + oklch 双行）**：每个 CSS 变量都是 `--x: #hex;` + `--x: oklch(...)` 双行，**oklch 行生效**（hex 行是供不支持 oklch 的老 uTools 内核的降级值，lightningcss 按 chrome 88 目标处理）。改色必须两行同步；oklch 4 位小数精度与 hex 存在 <1/255 转换误差（如 #f7f7f8 ≈ oklch(0.9785) 实测渲染 lab L=97.506 ≈ #f8f8f8），computed-style 断言不能比精确值，用 lab 区间断言（如 L∈(97.4,97.7)）。
8. **uTools 实际内核 = Chromium 108**（Electron 22，2026-08-14 从 uTools 7.8.0 安装目录 `uTools.exe` 二进制 UA 模板 `Electron/22 Chrome/108` 实测；官方 FAQ 的 "Chromium 91" 已过时）。Vite 8 产物 target = Chrome 107（baseline-widely-available），**Chromium 91 上 dist 直接崩**（`Unexpected token '{'`）。uTools 内核等价验证通道：puppeteer@19.0.0 下载的 Chrome 107（`C:\Users\Fengzhi\.cache\puppeteer\chrome\win64-1045629`）+ `BROWSER_PATH=<chrome.exe> npm run ui-smoke / smoke:decor-styles`。
9. **style-mod（`EditorView.theme()` 运行时注入）不经过 Lightning CSS 降级**：主题里写 `color-mix(in oklab, ...)` 在 Chromium 108 上**整条声明失效**（表格/活动行/图片背景变 transparent）。半透明语义色必须在 `src/index.css` 定义 `--editor-*` 双写变量（rgba 兜底行 + color-mix 覆盖行，`:root`/`.dark` 各一份），主题只引用 `var()`。注意 lightningcss 会把 rgba 兜底行优化为 `var(--muted)` 纯色——可接受（老内核实心背景、新内核 color-mix），不要依赖 dist 中 rgba 原样保留。
10. **行内标记（粗体/斜体/行内码/删除线）光标行机制**：Typora/Obsidian 式即时渲染要求标记非光标行隐藏（`sn-md-hidden`）、光标行淡化（`sn-md-dim`）。统一入口 `addMarkedStyle()`（markdownDecorations.ts），markName 按 lezer 节点传（EmphasisMark/StrikethroughMark/CodeMark）；GFM 删除线节点是 `Strikethrough`+`StrikethroughMark`，高亮 `==` 不在 GFM 解析范围。headless smoke（smoke-decorations）断言非光标行 hidden + 光标行 dim 两种状态都要覆盖。
11. **隐藏标记禁用 `display:none`，用 `font-size: 0`**（08-14 实测）：display:none 的 span 会让跨它的鼠标拖选断裂/失效（用户反馈"选中文字失效"）；font-size:0 + lineHeight:0 零宽隐藏不参与布局但选区连续。注意 DOM 的 innerText 仍包含标记文本（视觉零宽），这是预期行为。代码块语言选择器（.sn-lang-picker）非光标行常驻显示需带 pill 样式（背景+border），纯透明小字在 muted 背景上几乎不可见（用户反馈"hover 才有语言提示"）。
12. **表格 Block Widget 外框默认 `display: block` 会占满整行**：用户要求内容宽度 → `display: inline-block` + `maxWidth: 100%`（内部 table `width: max-content`）。工具条 hover 悬浮（opacity 0 → hover 1 + pointerEvents none/auto）后，**ui-smoke 点击行列按钮必须先 hover 表格**，且结构变化（增删列）会改变表格宽度，鼠标位置可能落到表格外导致 hover 丢失——每次点击前都要重新 hover。
13. **代码块 = 常驻 nested CM6 的 Block Widget（Typora 式独立输入框）**：闭合围栏（``` lang ... ```）→ `CodeBlockWidget`（markdownBlockWidgets.ts）替换整个 FencedCode 范围，header 语言 select（改 CodeInfo）+ body 常驻 nested editor（无围栏可见、连续输入）。**lezer 空代码块（```ts\n\n```）的 CodeText 含内容行尾换行（[6,7]="\n"）**——parseFencedCode 必须排除尾随 \n（codeTo 前移），否则 nested 同步 round-trip 漂移（首字符丢失/尾部重复，08-14 实测）。未闭合围栏（无闭 CodeMark）不 widget 化，走装饰兜底（addFencedCode）。插入后自动 focus：widget toDOM 时主光标在 [codeFrom, codeTo] → queueMicrotask focus nested。**原子 block widget 的光标推挤**：手动逐行输入表格（分隔行出现即 widget 化）会把光标推到文档前部——smoke 里表格必须工具栏一次性插入。
14. **CSS 变量值中 `hsl(0, 0%, 0% / .08)` 逗号+斜杠混合语法非法**（08-15 实测）：旧 shadcn 风格的阴影变量（`hsl(0, 0%, 0% / 0.08)`）在浏览器中整条变量无效 → `var(--shadow-*)` 解析为 none → **全部 shadow 工具类静默失效**（弹窗/下拉无阴影）。合法写法是空格分隔 `hsl(0 0% 0% / 0.08)`。index.css 已修复为空格语法；新增阴影变量时务必用空格分隔，并用 `getComputedStyle().boxShadow` 实测。
15. **Tailwind `@theme inline` 中同名变量自引用（`--shadow-lg: var(--shadow-lg)`）会让工具类生成失败**：@theme inline 的值展开模式把 var() 引用展开成自引用（CSS 变量循环 → guaranteed-invalid）。本项目 index.css 的 `--shadow-*` 由 :root/.dark 双态定义 + @theme inline 映射的既有模式**实际不生成 shadow 工具类**（dropdown/dialog 阴影此前一直失效）。新增阴影不要依赖 shadow-* 工具类：定义独立命名的变量（如 `--dialog-shadow`，双态），组件用内联 `style={{ boxShadow: 'var(--dialog-shadow)' }}` 引用。
