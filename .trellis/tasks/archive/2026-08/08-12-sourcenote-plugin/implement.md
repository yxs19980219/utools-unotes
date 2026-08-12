# SourceNote 执行计划

## 检查清单（按序执行）

### 阶段 0：项目脚手架
- [ ] 按 utools-dev skill 模板初始化：Vite + React 19 + TypeScript（react-ts 模板）、`public/plugin.json`、`public/preload/`（空壳 services.js + package.json commonjs）、`stripDevelopmentField` 插件、`base:'./'`、路径别名 `@/`
- [ ] Tailwind 4（@tailwindcss/vite）+ `npx shadcn@latest init`（Vite + TS + Tailwind 4，radix base）
- [ ] **将附录 A 设计 Token CSS 原样写入全局 CSS 文件**（不创建新文件，用 shadcn 指定的 tailwindCssFile）
- [ ] `npx shadcn@latest add` 组件：button input select dialog alert-dialog dropdown-menu tooltip badge separator scroll-area tabs toggle-group command empty sonner skeleton（按需，先查已装列表）
- [ ] 安装：zustand、@uiw/react-codemirror、@codemirror/lang-markdown、@codemirror/state、@codemirror/view、lucide-react（iconLibrary 以 shadcn info 为准）
- [ ] 入口注册 `utools.onPluginEnter`，action.code 路由；暗色：`utools.isDarkColors()` 或 prefers-color-scheme 监听 → 切换 html `.dark`
- [ ] **验证**：`npm run dev` 后 uTools 开发者工具接入 `public/`，窗口正常打开、浅深色切换正常

### 阶段 1：数据层
- [ ] `services/db.js`：封装 put/get/remove/allDocs（前缀 `object/`、`note/`、`tag/`、`setting/`），全部 promises API，更新带 `_rev`
- [ ] `services/tagNormalize.js`：文本 → canonical tagId（name/aliases 精确匹配归并，无匹配新建）
- [ ] `services/search.js`：tokenizer（`type:x` / `#x` / 裸词）+ 内存全文过滤 + 相关度排序
- [ ] **验证**：node 直测或临时测试页调用，schema 读写往返正确

### 阶段 2：状态层（Pinia）
- [ ] stores/objects.js、stores/notes.js、stores/tags.js（含计数计算、删除级联）、stores/ui.js（当前视图/选中项/搜索态）
- [ ] 启动加载：一次 `allDocs` 全量入内存，store 同步

### 阶段 3：UI 骨架
- [ ] App.vue：侧边栏（分段控件 + 视图列表区）+ 内容区两栏布局，800×600 无横向滚动
- [ ] ViewSwitcher 四段控件（归档/设置置灰或隐藏，二期启用）
- [ ] CSS 变量 + `prefers-color-scheme` 暗色适配

### 阶段 4：首页视图（核心闭环）
- [ ] HomeList：钉住对象列表 + 钉住标签列表（空态引导文案）
- [ ] ObjectDetail：元数据条（来源类型/作者/URL/标签 chip）+ [新建笔记][排序] + NoteCardList
- [ ] NoteCardList / NoteCard：标题、标签 chip、时间、来源类型角标；点击 → 详情/编辑
- [ ] 对象/笔记 CRUD：新建（对象联想下拉 + 即时新建对象表单）、编辑、删除（对象删除级联确认）

### 阶段 5：编辑器（即时渲染，路径 A）
- [ ] 集成 @uiw/react-codemirror + @codemirror/lang-markdown（基础编辑能力、主题跟随 token）
- [ ] 自研 decorations 即时渲染：标题（#~#### 行首淡色标记 + 整行标题样式，光标行显示淡色标记）、粗体/斜体/行内代码、列表（ul/ol/任务）、引用、分隔线、链接——MVP 覆盖以上核心语法，光标行标记淡色显示，失焦行标记隐藏
- [ ] 预览/编辑切换按钮；Ctrl+S 保存；保存后返回卡片列表
- [ ] 标签输入：TagInput 联想补全（匹配 name+aliases 模糊，shadcn Command 弹层），选择写入 canonical tagId

### 阶段 6：标签视图
- [ ] TagList：全部标签（name + 计数）+ 标签详情（编辑别名/钉住/删除）
- [ ] 点击标签 → 跨对象 NoteCardList

### 阶段 7：搜索
- [ ] 子输入框接入：`utools.setSubInput`，输入即搜，结果卡片流（含归档命中只读标记）
- [ ] 排序菜单（最近更新/创建时间/标题/相关度）+ 来源筛选下拉
- [ ] **验证**：`type:book 注意力`、`#深度学习`、组合语法

### 阶段 8：整体检查
- [ ] PRD 验收 AC1-AC6、AC8、AC10 逐条跑测
- [ ] trellis-check（spec 合规、lint、跨层数据流）
- [ ] `npm run build` → dist/ 干净（无 development 字段）→ uTools 加载 dist/ 验证

## 验证命令

```bash
npm run dev        # 开发 HMR
npm run build      # 发布构建（检查 dist/plugin.json 无 development）
```

## 风险与回滚点

| 风险 | 缓解 | 回滚点 |
|------|------|--------|
| bytemd 依赖安装/体积问题 | 降级 @uiw/react-md-editor（编辑/预览分离，数据层不受影响） | 阶段 5 起点 |
| CodeMirror 6 装饰器复杂度过高 | 先实现核心语法（标题/粗斜/列表/引用/行内代码），其余迭代 | 阶段 5 起点 |
| utools.db API 细节偏差 | 实现前读 references/utools-api.md 对应章节 | 阶段 1 起点 |
| 800×600 下布局拥挤 | 阶段 3 先行验证布局，再叠功能 | 阶段 3 起点 |
| 搜索性能（笔记量>万条） | 当前设计内存过滤，量级不符时二期加索引（不入 db） | 阶段 7 起点 |

## 阶段验收后动作

- 跑通后由 trellis-check 全量检查 → 更新 spec（.trellis/spec/ 相关约定）→ 提交（首个 commit 含全部产物）
