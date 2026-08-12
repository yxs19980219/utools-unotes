# SourceNote（utools-unotes）

uTools 源笔记插件：以**学习对象**为载体（一本书 / 一篇论文 / 一门课程 / 一个 GitHub 项目…），用最低成本记录要点、用最快速度检索。源笔记是写主卡（Zettelkasten）之前的**跳板**——记录即沉淀，搜到即用。

## 功能

- **四视图分段切换**：首页（钉住对象 + 钉住标签）/ 标签 / 归档 / 设置
- **学习对象模型**：对象 = 生命周期单元（钉住 / 归档），笔记挂对象，全库扁平、无文件夹
- **快速创建**：新建笔记只填标题（可留空自动占位）和标签，保存即卡片；点击卡片进入详情写正文
- **即时渲染编辑器**（CodeMirror 6）：输入 `#` / `-` / `**` 实时渲染样式，光标行显示淡色标记，移开顶格显示；源码始终是标准 Markdown
- **Markdown 快捷工具栏**（编辑态一行 19 项）：标题 / 列表 / 勾选框 / 引用 / 代码块 / 表格 / 公式 / 加粗 / 斜体 / 高亮…
- **标签别名归并**：`deep learning` = `深度学习` = `DL`，输入联想补全，展示统一规范名
- **全文搜索**：uTools 子输入框即搜（`type:book 注意力 #深度学习` 语法，相关度排序）
- **深色模式**：跟随系统；800×600 紧凑布局

## 安装

从 [GitHub Releases](https://github.com/yxs19980219/utools-unotes/releases) 下载最新 `SourceNote-*.zip`：

```
uTools → 设置 → 插件 → 开发者工具 → 导入 zip
```

## 快速上手

```
1. 新建对象：右上角「新建」→ 新建对象（书 / 课程 / GitHub 项目…，填来源信息）
2. 记笔记：对象详情页「＋新笔记」→ 填标题 + 标签 → 保存
3. 写正文：点击笔记卡片 → 直接开始写（Markdown 即时渲染 + 工具栏）
4. 检索：uTools 搜索栏输入 type:book 注意力 或 #深度学习（或点击标签视图）
5. 聚焦：首页钉住当前在学的对象和主题标签
```

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 开发模式（uTools 开发者工具接入 public/，HMR）
npm run build      # 构建 dist/（发布产物，无 development 字段）
npm run typecheck  # TypeScript 检查
npm run smoke      # 数据层冒烟（19 断言）
npm run smoke:stores      # 状态层冒烟（13 断言）
npm run smoke:decorations # 编辑器装饰冒烟（7 断言）
npm run ui-smoke  # 渲染层冒烟（需 dev server + 系统 Edge/Chrome）
```

> 开发时：`npm run dev` 后，uTools 开发者工具选择 `public/` 目录（development.main 指向 5173）。
> 上架时：`npm run build` 后上传 `dist/` 目录或打包 zip，无需 upx。

### 目录结构

```
public/             uTools 接入目录（plugin.json / preload，dev 模式）
src/
├── services/       utools.db 封装 / 标签归并 / 全文搜索
├── stores/         Zustand 状态（ui / objects / notes / tags）
├── components/     视图组件（列表 → 卡片流 → 全文 两级导航）
│   └── Editor/     CodeMirror 即时渲染装饰器 + 快捷工具栏
├── lib/            工具
└── types.ts        schema v1 数据模型
scripts/            冒烟测试脚本
```

## 技术栈

React 19 · Vite · TypeScript · Tailwind 4 · shadcn/ui · Zustand 5 · CodeMirror 6 · utools.db（Lightning CSS 降级兼容旧内核）

## 发布流程

见 `.trellis/spec/frontend/quality-guidelines.md` 的 Release Process 一节。
