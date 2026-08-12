# SourceNote 技术设计

## 1. 技术栈选型（用户已确认）

| 项 | 选择 | 说明 |
|----|------|------|
| UI 框架 | **React 19 + Vite**（TypeScript） | utools-dev skill 提供 React 模板；TS 用 utools-api-types 类型提示 |
| 构建 | Vite + `stripDevelopmentField` 插件，`base: './'` | skill 铁律：dev 模式 `public/`（HMR）、build 产物 `dist/` 无 `development` 字段 |
| 样式 | **Tailwind 4**（@tailwindcss/vite）+ CSS 变量 token | 暗色模式用 `prefers-color-scheme` + shadcn token 体系 |
| 组件库 | **shadcn/ui** | 紧凑密度适配 800×600；token 定制见第 5 节 UI 设计体系 |
| 状态管理 | **Zustand 5** | stores 按域拆分：objects / notes / tags / ui |
| 存储 | **utools.db**（文档型，前缀 `_id` 分类） | 笔记/对象/标签均为用户主动创建的数据，符合红线；自带跨设备同步 |
| 编辑器 | **CodeMirror 6 自研装饰**（路径 A，用户已确认） | @uiw/react-codemirror + @codemirror/lang-markdown + 自研 decorations：即时渲染，标记淡色显示（Obsidian Live Preview 同思路），源码即 markdown |

**风险**：编辑器装饰器实现（约 1-2 天）若遇到不可控问题，降级为 @uiw/react-md-editor（编辑/预览分离），数据层不受影响。

## 2. 架构与边界

```
┌─────────────────────────────────────────────────────┐
│ 渲染进程 (Vue3 + Pinia)                               │
│                                                     │
│  components/                                        │
│   ├─ ViewSwitcher（分段控件 首页|标签|归档|设置）         │
│   ├─ HomeList / TagList（侧边栏列表）                  │
│   ├─ ObjectDetail（元数据条 + NoteCardList）           │
│   ├─ NoteCardList / NoteCard（卡片流，全产品复用）      │
│   ├─ NoteEditor（bytemd）                            │
│   └─ common/（TagChip / Dropdown / ConfirmDialog）    │
│                                                     │
│  stores/   objects | notes | tags | ui               │
│      ↓ 读写                                          │
│  services/ db.js（utools.db 封装）                    │
│            search.js（语法解析+内存全文搜索）            │
│            tagNormalize.js（别名归并）                 │
│      ↓                                                │
│  preload/ services.js（最小权限桥，本期可空壳）           │
│      ↓                                                │
│  utools.db（持久化） + 子输入框（setSubInput 搜索入口）   │
└─────────────────────────────────────────────────────┘
```

**边界**：
- UI 组件不直接碰 `utools.db`，一律经 store → services/db.js
- 搜索在**内存**全量过滤（启动时一次 `allDocs` 加载，量级千条内毫秒级）；红线禁止把搜索索引写入 db
- 渲染进程只依赖 `utools` 全局对象（uTools 注入），preload 本期无需自定义能力，预留空壳

## 3. 数据模型（utools.db 文档 schema v1）

`_id` 前缀分类（skill 要求），全部为**用户主动创建数据**：

```
object/<uuid>    对象（对象笔记）
{
  _id, _rev,
  title: string,            // 书名/课程名/项目名
  sourceType: string,       // 枚举: book|article|video|paper|github|course|自定义
  sourceMeta: {             // 按类型填写：author/url/year/publisher…
    author?, url?, year?, extra?: string
  },
  tags: string[],           // canonical tagId 列表
  pinned: boolean,
  archived: boolean,        // 二期使用，schema 一次到位
  createdAt, updatedAt
}

note/<uuid>      普通笔记
{
  _id, _rev,
  objectId: string,         // 必填，归属对象（AC10）
  title: string,
  content: string,          // Markdown 正文
  tags: string[],           // canonical tagId 列表
  createdAt, updatedAt
}

tag/<slug>       标签实体
{
  _id, _rev,
  name: string,             // 规范名，如 "深度学习"
  aliases: string[],        // 别名，如 ["deep learning","DL"]
  createdAt
}

setting/<key>    设置（二期：来源类型枚举等）
```

**关键契约**：
- 笔记/对象的 `tags` 存 **tagId**（非名称）→ 标签重命名/别名编辑 O(1)，不遍历笔记；删除标签时遍历笔记清理引用（量小可接受）
- 标签规范化（tagNormalize）：写入时输入文本 → 精确匹配 name/aliases → 归并到 canonical tagId；无匹配则新建标签（slug 由名称生成，冲突加后缀）
- 对象删除：级联删除其下所有笔记（确认框提示数量）
- 全部写操作走 `utools.db.promises.put`，更新必须带 `_rev`

## 4. 搜索设计

**入口**：`utools.setSubInput(({text}) => …)` —— 进入插件后 uTools 搜索条变为子输入框，输入实时触发搜索（确认于 utools-api.md §setSubInput）。

**语法**（自研轻量 tokenizer）：
```
type:book 注意力 #深度学习
→ 过滤器: sourceType=book ∧ tags含#深度学习  ∧ 全文命中"注意力"
```
- `type:x`：来源类型精确匹配（x 支持前缀匹配，如 `type:bo`）
- `#x`：标签匹配（匹配 name 或 aliases，模糊）
- 裸词：标题/标签/正文子串匹配（小写化）
- 排序：默认相关度（标题命中 > 标签命中 > 正文命中，词频加分）；浏览态默认最近更新倒序

**实现**：启动全量载入内存（notes+objects+tags），搜索纯内存过滤；结果返回 `{note, object, tagMatches}[]`，UI 渲染 NoteCardList。归档笔记也可命中（AC9 语义，只读查看）。

## 5. UI 设计体系（用户已确认）

### 视觉风格
- **黑白灰主题**（用户提供的 shadcn v4 Token 契约，OKLCH 色板，primary 为浅灰/深灰中性色，无彩色强调）
- 浅色/深色两套 Token（`.dark` 类切换，uTools 暗色模式时给 html 加 `.dark`）
- **紧凑密度**：组件尺寸降一档（h-8/h-7）、列表/卡片间距收紧，适配 800×600
- 字体栈：Inter / JetBrains Mono 声明在前，系统 fallback（**不加载外部字体**，uTools 红线）
- `--radius: 0.75rem`，shadow/tracking 按用户契约

### 设计 Token 契约（完整 CSS 见附录 A，实现时原样写入全局 CSS）
- 结构：`@import "tailwindcss"` + `@custom-variant dark` + `:root`/`.dark` 变量 + `@theme inline` 映射 + `@layer base`
- 组件用语义 Token（bg-background/text-muted-foreground 等），禁止裸色值
- 字体声明仅 font-family 栈，无网络加载

### 关键交互细节（已确认）
1. **编辑态**：全内容区替换（不分屏），预览/编辑切换按钮，`Ctrl+S` 保存后返回卡片列表
2. **搜索触发**：浏览态下内容区标题行左侧小放大镜按钮 → `utools.subInputFocus()` 聚焦子输入框（不常驻搜索框）
3. **操作入口**：卡片悬停显示编辑/删除按钮；钉住/归档在对象详情元数据条；删除/归档用 shadcn AlertDialog 确认
4. **空态**：首页无钉住时显示"新建对象"引导 CTA（shadcn Empty 组件）；搜索无结果时显示语法提示
5. **新建流程**：新建对象/笔记均为全内容区表单（800×600 下弹窗空间不足），标题行右侧 [＋新建] 下拉二选一

### shadcn 组件来源
- 经 `npx shadcn@latest add` CLI 源码引入（见 shadcn skill），MVP 预计：Button / Input / Select / Dialog / AlertDialog / DropdownMenu / Tooltip / Badge / Separator / ScrollArea / Empty / Tabs 或 ToggleGroup / Command（对象与标签联想）/ Sonner（toast）
- 暗色切换：uTools 主题变化时动态增删 `document.documentElement.classList` 的 `.dark`（用 `utools.isDarkColors()` 或 CSS `prefers-color-scheme` 监听）

## 附录 A：设计 Token CSS（用户确认契约，实现时原样落位）

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(1.0000 0 0);
  --foreground: oklch(0.2156 0 0);
  --card: oklch(1.0000 0 0);
  --card-foreground: oklch(0.2156 0 0);
  --popover: oklch(1.0000 0 0);
  --popover-foreground: oklch(0.2156 0 0);
  --primary: oklch(0.9079 0 0);
  --primary-foreground: oklch(0.2156 0 0);
  --secondary: oklch(0.9542 0 0);
  --secondary-foreground: oklch(0.2156 0 0);
  --muted: oklch(0.9696 0 0);
  --muted-foreground: oklch(0.5103 0 0);
  --accent: oklch(0.9389 0 0);
  --accent-foreground: oklch(0.2156 0 0);
  --destructive: oklch(0.6356 0.2082 25.3782);
  --destructive-foreground: oklch(0.9848 0 0);
  --border: oklch(0.9079 0 0);
  --input: oklch(0.9079 0 0);
  --ring: oklch(0.5103 0 0);
  --chart-1: oklch(0.3211 0 0);
  --chart-2: oklch(0.5103 0 0);
  --chart-3: oklch(0.6830 0 0);
  --chart-4: oklch(0.8054 0 0);
  --chart-5: oklch(0.9234 0 0);
  --sidebar: oklch(0.9848 0 0);
  --sidebar-foreground: oklch(0.3211 0 0);
  --sidebar-primary: oklch(0.9079 0 0);
  --sidebar-primary-foreground: oklch(0.2156 0 0);
  --sidebar-accent: oklch(0.9389 0 0);
  --sidebar-accent-foreground: oklch(0 0 0);
  --sidebar-border: oklch(0.9234 0 0);
  --sidebar-ring: oklch(0.5103 0 0);
  --font-sans: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  --font-serif: Georgia, serif;
  --font-mono: JetBrains Mono, monospace;
  --radius: 0.75rem;
  --shadow-x: 0px;
  --shadow-y: 4px;
  --shadow-blur: 12px;
  --shadow-spread: 0px;
  --shadow-opacity: 0.08;
  --shadow-color: 0, 0%, 0%;
  --shadow-2xs: 0px 4px 12px 0px hsl(0, 0%, 0% / 0.04);
  --shadow-xs: 0px 4px 12px 0px hsl(0, 0%, 0% / 0.04);
  --shadow-sm: 0px 4px 12px 0px hsl(0, 0%, 0% / 0.08), 0px 1px 2px -1px hsl(0, 0%, 0% / 0.08);
  --shadow: 0px 4px 12px 0px hsl(0, 0%, 0% / 0.08), 0px 1px 2px -1px hsl(0, 0%, 0% / 0.08);
  --shadow-md: 0px 4px 12px 0px hsl(0, 0%, 0% / 0.08), 0px 2px 4px -1px hsl(0, 0%, 0% / 0.08);
  --shadow-lg: 0px 4px 12px 0px hsl(0, 0%, 0% / 0.08), 0px 4px 6px -1px hsl(0, 0%, 0% / 0.08);
  --shadow-xl: 0px 4px 12px 0px hsl(0, 0%, 0% / 0.08), 0px 8px 10px -1px hsl(0, 0%, 0% / 0.08);
  --shadow-2xl: 0px 4px 12px 0px hsl(0, 0%, 0% / 0.20);
  --tracking-normal: -0.01em;
  --spacing: 0.25rem;
}

.dark {
  --background: oklch(0.2044 0 0);
  --foreground: oklch(0.9848 0 0);
  --card: oklch(0.2376 0 0);
  --card-foreground: oklch(0.9848 0 0);
  --popover: oklch(0.2376 0 0);
  --popover-foreground: oklch(0.9848 0 0);
  --primary: oklch(0.4184 0 0);
  --primary-foreground: oklch(1.0000 0 0);
  --secondary: oklch(0.3411 0 0);
  --secondary-foreground: oklch(0.9848 0 0);
  --muted: oklch(0.3008 0 0);
  --muted-foreground: oklch(0.7652 0 0);
  --accent: oklch(0.3994 0 0);
  --accent-foreground: oklch(0.9848 0 0);
  --destructive: oklch(0.4776 0.1631 25.9396);
  --destructive-foreground: oklch(0.9848 0 0);
  --border: oklch(0.3411 0 0);
  --input: oklch(0.3411 0 0);
  --ring: oklch(0.7652 0 0);
  --chart-1: oklch(1.0000 0 0);
  --chart-2: oklch(0.8845 0 0);
  --chart-3: oklch(0.7652 0 0);
  --chart-4: oklch(0.6409 0 0);
  --chart-5: oklch(0.5103 0 0);
  --sidebar: oklch(0.2376 0 0);
  --sidebar-foreground: oklch(0.9234 0 0);
  --sidebar-primary: oklch(0.4184 0 0);
  --sidebar-primary-foreground: oklch(1.0000 0 0);
  --sidebar-accent: oklch(0.3705 0 0);
  --sidebar-accent-foreground: oklch(1.0000 0 0);
  --sidebar-border: oklch(0.3211 0 0);
  --sidebar-ring: oklch(0.7652 0 0);
  --font-sans: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  --font-serif: Georgia, serif;
  --font-mono: JetBrains Mono, monospace;
  --radius: 0.75rem;
  --shadow-x: 0px;
  --shadow-y: 6px;
  --shadow-blur: 20px;
  --shadow-spread: 0px;
  --shadow-opacity: 0.4;
  --shadow-color: 0, 0%, 0%;
  --shadow-2xs: 0px 6px 20px 0px hsl(0, 0%, 0% / 0.20);
  --shadow-xs: 0px 6px 20px 0px hsl(0, 0%, 0% / 0.20);
  --shadow-sm: 0px 6px 20px 0px hsl(0, 0%, 0% / 0.40), 0px 1px 2px -1px hsl(0, 0%, 0% / 0.40);
  --shadow: 0px 6px 20px 0px hsl(0, 0%, 0% / 0.40), 0px 1px 2px -1px hsl(0, 0%, 0% / 0.40);
  --shadow-md: 0px 6px 20px 0px hsl(0, 0%, 0% / 0.40), 0px 2px 4px -1px hsl(0, 0%, 0% / 0.40);
  --shadow-lg: 0px 6px 20px 0px hsl(0, 0%, 0% / 0.40), 0px 4px 6px -1px hsl(0, 0%, 0% / 0.40);
  --shadow-xl: 0px 6px 20px 0px hsl(0, 0%, 0% / 0.40), 0px 8px 10px -1px hsl(0, 0%, 0% / 0.40);
  --shadow-2xl: 0px 6px 20px 0px hsl(0, 0%, 0% / 1.00);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --font-serif: var(--font-serif);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --shadow-2xs: var(--shadow-2xs);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow: var(--shadow);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-xl: var(--shadow-xl);
  --shadow-2xl: var(--shadow-2xl);

  --tracking-tighter: calc(var(--tracking-normal) - 0.05em);
  --tracking-tight: calc(var(--tracking-normal) - 0.025em);
  --tracking-normal: var(--tracking-normal);
  --tracking-wide: calc(var(--tracking-normal) + 0.025em);
  --tracking-wider: calc(var(--tracking-normal) + 0.05em);
  --tracking-widest: calc(var(--tracking-normal) + 0.1em);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    letter-spacing: var(--tracking-normal);
  }
}
```

## 6. 视图与交互流（MVP：首页 + 标签）

```
App
├─ 分段控件: [首页|标签|归档(二期)|设置(二期)]
├─ 首页视图
│  ├─ 侧边栏: 钉住对象列表 ▾ / 钉住标签列表 ▾（无钉住时显示空态引导）
│  └─ 内容区: 未选中 → 空态；点对象 → ObjectDetail；点标签 → 该标签 NoteCardList
├─ 标签视图
│  ├─ 侧边栏: 全部标签（name + 计数，计数内存计算）
│  └─ 内容区: 点标签 → NoteCardList（跨对象）
└─ 编辑器弹层/页面: 新建笔记（必选对象：联想下拉，可即时新建对象）/ 编辑
```

- 新建对象：表单（标题、来源类型下拉[含自定义]、元数据字段、标签）
- 新建笔记：对象联想下拉（按标题模糊）→ 标题 + bytemd 正文 + 标签输入（联想补全，匹配 name+aliases）→ 保存
- 标题行右侧：排序菜单（最近更新/创建时间/标题）+ 来源筛选下拉（MVP 可做筛选，属 R17 低风险项）

## 7. 兼容性与部署

- plugin.json：`main: index.html`、`preload: preload/services.js`、`features: [{code:"sourcenote", cmds:["源笔记","sourcenote"]}]`、`pluginSetting: {single:true, height:600}`
- 平台：三平台通用（无平台特有 API 依赖）
- 数据演进：schema 字段全部可选缺省兜底（老文档读取容错），v1 内无迁移需求；归档/设置二期仅新增视图与 setting 文档，不加字段

## 8. 权衡记录

| 决策 | 权衡 |
|------|------|
| utools.db 而非本地文件 | 换来跨设备同步；受 db 文档大小限制（长笔记需注意，可二期拆附件） |
| 内存全文搜索而非 FTS | 量级小完全够用；符合红线（索引不入库）；语法解析可控 |
| 标签存 tagId 引用 | 重命名 O(1) 但删除需遍历；量小可接受 |
| shadcn/ui + Tailwind 4 | 组件开发快、token 体系现成；包体积较大（发布时 tree-shake 后可控） |
| TypeScript | 数据模型强约束；utools-api-types 提供 uTools 类型 |
| 全内容区表单替代弹窗 | 800×600 下弹窗空间不足；编辑态上下文完整 |
