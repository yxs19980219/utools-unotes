# utools-unotes

uTools 源笔记插件：以**学习对象**为载体（一本书 / 一篇论文 / 一门课程 / 一个 GitHub 项目…），用最低成本记录要点、用最快速度检索。源笔记是写主卡（Zettelkasten）之前的**跳板**——记录即沉淀，搜到即用。

## 核心设计哲学与理念

### 1. 对象是唯一载体，全库扁平无文件夹

笔记永远挂在某个**学习对象**下，对象就是生命周期单元（活跃 / 归档）。没有目录树、没有多级分类——侧边栏一屏看完所有对象与标签，检索靠搜索而非翻找。归档是"状态"不是"隔离区"：归档对象及其笔记转为只读，随时可恢复。

### 2. 记录即沉淀，链路每一步都在降摩擦

- **快速创建**：新笔记只填标题（留空自动生成「未命名」）和标签，一步保存成卡片
- **点开即写**：点击卡片直接进入正文编辑，没有"写正文"按钮、没有编辑/预览切换
- **实时保存**：正文输入停止 500ms 自动落盘，无保存按钮、无未保存概念、无确认弹窗——数据只在写入失败的极端情况下提示

### 3. 少即是多：信息按需出现，操作藏进主动行为

- 区域划分用**色阶**（浅灰侧边栏 vs 纯白内容区），不用分割线
- 顶栏只留高频操作（排序 / ℹ 元数据查看 / 新笔记）；归档、编辑、删除、恢复全部收敛到**对象行右键菜单**——低频操作不占据视线，也不怕误触
- 来源元数据（作者 / 年份 / 链接）不常驻展示，点圆形 ℹ 按需查看
- 设置入口是侧边栏底部一个齿轮，视图栏只保留首页 / 标签 / 归档三个浏览视图

### 4. 检索优先：uTools 子输入框即全文搜索

打开插件直接在 uTools 搜索条输入即搜，支持语法组合（`type:book 注意力 #深度学习`），相关度排序；来源类型与标签语法可叠加筛选。

### 5. 标签归一：别名归并

`deep learning` = `深度学习` = `DL`——输入任意别名联想补全，保存时统一归并到规范名，展示永远一致。删除/重命名标签自动清理全库引用。

### 6. 数据契约先行（对开发者）

utools.db 是唯一数据源，一切读写经 `services/db.ts`；store 写操作"先 db 后内存"，`_rev` 契约防冲突；文档类型守卫是收窄的唯一入口；无 uTools 环境时自动降级为内存实现，全部冒烟测试可脱离插件运行。

## 功能总览

- **三视图 + 设置**：首页（活跃对象 + 钉住标签，分区随视口自适应）/ 标签 / 归档 / 设置（底部齿轮）
- **学习对象模型**：来源类型（内置书 / 视频 / 课程等 + 自定义）、来源元数据、钉住 / 归档 / 恢复
- **即时渲染编辑器**（CodeMirror 6）：`#` / `-` / `**` / 勾选框 / 表格等输入即渲染，光标行淡色提示、移开顶格；源码始终是标准 Markdown
- **Markdown 快捷工具栏**（编辑态 19 项插入）：标题 / 列表 / 勾选框 / 引用 / 代码块 / 表格 / 公式 / 加粗 / 斜体 / 高亮…
- **实时保存**：正文 500ms 防抖自动落盘，静默成功、失败 toast
- **全文搜索**：子输入框即搜，`type:` 前缀 / `#标签` / 裸词 AND 组合，相关度 + 三种排序
- **笔记卡片流**：标题 + 前两行摘要 + 标签 + 时间，悬停编辑 / 删除，跨对象语境显示归属对象与来源角标
- **深色模式**：跟随系统；800×600 紧凑布局，无横向滚动

## 模块结构

```
src/
├── services/            数据层（唯一 db 入口）
│   ├── db.ts            utools.db 封装：_id 前缀分类、_rev 契约、类型守卫、
│   │                    无 uTools 环境自动降级 MemoryDb（冒烟测试依赖）
│   ├── search.ts        自研 tokenizer 全文搜索：type: 前缀 / #标签 / 裸词 AND、相关度
│   └── tagNormalize.ts  标签归并：matchTag 精确归并、suggestTags 模糊联想、
│                        findTagConflicts 改名冲突检测
├── stores/              Zustand 状态（db 的内存投影，先 db 后内存）
│   ├── ui.ts            视图 / 选中项 / 搜索态 / 编辑态 / 排序偏好 / lastBrowseView
│   ├── objects.ts       对象域：钉住 / 归档互斥编排、级联删除编排
│   ├── notes.ts         笔记域：实时保存 update、AC10 归属强校验
│   ├── tags.ts          标签域：归并语义（resolveTagIds）、删除跨域引用清理
│   ├── settings.ts      来源类型管理（内置锁定 + 自定义增删、引用计数）
│   └── bootstrap.ts     启动全量加载（一次 allDocs 按守卫分区 hydrate，幂等）
├── components/
│   ├── App.tsx          两栏骨架：侧边栏（浅灰）+ 内容区（纯白），色阶分区
│   ├── ViewSwitcher.tsx 三视图分段控件（悬停底色 / 选中加粗）
│   ├── SidebarList.tsx  侧边栏列表：活跃对象 / 钉住标签分区（1:2）、标签视图、
│   │                    归档视图；对象行右键菜单（编辑/归档/删除/恢复）
│   ├── SidebarSettingsButton.tsx  底部齿轮（设置入口）
│   ├── ContentHeader.tsx 内容区唯一顶栏（语境化：对象详情 / 搜索 / 标签 / 编辑态）
│   ├── ContentArea.tsx  内容区路由（编辑态 > 笔记全文 > 搜索 > 对象详情 > 标签列表）
│   ├── NoteCardList.tsx 全产品唯一列表形态（对象 / 标签 / 搜索三语境复用）
│   ├── NoteView.tsx     笔记详情：进即编辑 + 500ms 实时保存（串行化防 _rev 冲突）；
│   │                    归档只读（MarkdownView 渲染）
│   ├── NoteFormDialog.tsx 新建/编辑笔记小窗（Dialog）
│   ├── ObjectDetail.tsx 对象详情卡片流（顶栏信息已收敛至 ContentHeader）
│   ├── ObjectForm.tsx   新建/编辑对象表单（全内容区：标题 + 来源 + 元数据）
│   ├── SettingsView.tsx 设置页：来源类型管理（引用计数删除）+ 默认排序偏好
│   ├── TagInput.tsx     标签联想输入（Popover 候选、回车创建、键盘导航）
│   ├── MarkdownView.tsx 只读 Markdown 渲染器（归档笔记 / 表格等块级支持）
│   └── Editor/          CodeMirror 即时渲染装饰器（markdownDecorations.ts，
│                        装饰只改显示不改源码）+ 快捷工具栏（MarkdownToolbar.tsx）
├── lib/
│   ├── sourceTypes.ts   来源类型枚举投影（label / icon / 联想）
│   ├── objectActions.ts 对象生命周期操作（归档 / 恢复 / 级联删除，右键与顶栏共用）
│   ├── format.ts        时间格式化统一入口
│   └── markdown.ts      Markdown 块级语法正则（单一 owner）
├── types.ts             schema 数据模型（Note / NoteObject / Tag / Setting）
└── index.css            设计 Token（语义色 / 圆角 / 阴影）+ 全局样式
```

## 快速上手

```
1. 新建对象：侧边栏「＋」或首页空态引导（书 / 课程 / GitHub 项目…，填来源信息）
2. 记笔记：对象详情页「＋新笔记」→ 弹窗填标题（可留空）+ 标签 → 保存
3. 写正文：点击笔记卡片 → 直接开始写（即时渲染 + 工具栏，自动实时保存）
4. 检索：uTools 搜索栏输入 type:book 注意力 或 #深度学习（或点标签视图）
5. 聚焦：首页钉住当前在学的对象和主题标签（下区 2 倍宽）
6. 设置：侧边栏底部齿轮（来源类型管理 / 默认排序）
```

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 开发模式（uTools 开发者工具接入 public/，HMR）
npm run build      # 构建 dist/（发布产物，无 development 字段）
npm run typecheck  # TypeScript 检查
npm run smoke      # 数据层冒烟（19 断言）
npm run smoke:stores      # 状态层冒烟（18 断言）
npm run smoke:decorations # 编辑器装饰冒烟（8 断言）
npm run ui-smoke  # 渲染层冒烟（47 断言，需 dev server + 系统 Edge/Chrome，条件等待约 8s）
```

> 开发时：`npm run dev` 后，uTools 开发者工具选择 `public/` 目录（development.main 指向 5173）。
> 上架时：`npm run build` 后上传 `dist/` 目录或打包 zip，无需 upx。
> 冒烟体系说明：无单测框架，以 4 个冒烟脚本替代（node 直测 + 无头浏览器真实 DOM 验证），覆盖数据契约 / store 编排 / 编辑器装饰 / 核心 UI 闭环。

### 目录结构（开发）

```
public/             uTools 接入目录（plugin.json / preload，dev 模式）
src/                见上方「模块结构」
scripts/            冒烟测试（smoke-*.ts / ui-smoke.mjs）
```

## 技术栈

React 19 · Vite · TypeScript · Tailwind 4 · shadcn/ui · Zustand 5 · CodeMirror 6 · utools.db（Lightning CSS 降级兼容旧内核）

## 发布流程

见 `.trellis/spec/frontend/quality-guidelines.md` 的 Release Process 一节（version bump → tag → zip → GitHub Release → uTools 平台上传）。
