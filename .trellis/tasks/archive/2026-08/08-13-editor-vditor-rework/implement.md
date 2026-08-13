# Implement：Vditor IR 编辑区重构执行计划

## 阶段 1：引擎接入（骨架替换）

**1.1 依赖与资源**
- [ ] `npm i vditor`；`npm i -D highlight.js@11`
- [ ] 复制 `node_modules/vditor/dist/js/lute/lute.min.js`、`js/i18n/zh_CN.js` → `public/vditor/dist/js/` 对应路径
- [ ] `scripts/build-hljs-subset.mjs`：hljs core + 10 语言（js/ts/python/json/md/css/xml/bash/cpp/java）IIFE 打包 → `public/vditor/dist/js/highlight.js/highlight.min.js`（挂 window.hljs），幂等可重跑；产物提交

**1.2 VditorEditor.tsx（新）**
- [ ] 非受控 IR 实例：mode:'ir'、cache 关、cdn:'/vditor'、toolbar:[]、counter 关、placeholder、preview.hljs.langs 收敛
- [ ] ref API：`insertMD(md)`、`focus()`；input → onInput（不 setState）；keydown 捕获 Ctrl+S → onSave
- [ ] dark 联动：MutationObserver 监听 html.dark → setTheme('dark'/'classic')
- [ ] noteId 变化：setValue(content, true) 重置

**1.3 NoteView.tsx 接入**
- [ ] 替换 CodeMirrorEditor → VditorEditor；draft state 删除，draftRef + onInput 防抖保存（500ms + 卸载 flush + Ctrl+S 保留）
- [ ] 删除 CodeMirrorEditor.tsx、markdownDecorations.ts；卸载 @uiw/react-codemirror、@codemirror/* 依赖；清 index.css 中 sn-md-* 装饰样式

**1.4 验证门（阶段 1）**
- [ ] `npm run typecheck && npm run build` 绿
- [ ] `npm run ui-smoke` 更新编辑器断言（.cm-content → .vditor-ir，sn-md-h1 → vditor 标题节点）后全绿
- [ ] 手动：dev 打开笔记输入 `# `、`- `、` ``` ` 验证 IR 即时渲染与标记隐藏

## 阶段 2：布局 + 工具栏 + 元信息

**2.1 NoteView 头部重构**
- [ ] 标题行：返回 + 大标题（text-lg）+ 标签组（text-xs、flex-wrap、紧跟标题，无标签不空行）；删「更新于」
- [ ] 只读态头部同步（标题+标签，无工具栏）

**2.2 MarkdownToolbar 改造**
- [ ] 容器 `border-y border-border`（上下细线）
- [ ] 按钮全部接 insertMD：加粗/斜体/删除线/标题/列表/任务/引用/行内代码/分割线（含选区包裹与占位光标）
- [ ] 代码块按钮 → 插入 ``` 围栏；表格按钮 → 插入 GFM 表格语法（验证 IR 渲染 + 快捷键增删行列）
- [ ] 图片按钮 → 文件选择（uTools: utools.showOpenDialog + preload readFileBase64；dev: input[type=file] + FileReader）→ base64 ≤10MB → insertValue 插入即显示
- [ ] preload/services.js 扩展：showOpenImageDialog() + readFileBase64()（仅 uTools 挂载；uTools 无 readFileBase64 API 则用 Node fs 读文件，最小权限）

**2.3 MetaPopover（ⓘ）**
- [ ] 工具栏最右圆形感叹号按钮（Popover 触发）
- [ ] 内容：创建/更新时间（formatTime）+ 字数（getValue 去空白计数）
- [ ] 大纲：读取 vditor.outline.element DOM 克隆渲染，层级缩进，点击跳转（data-block-id 定位 + scrollIntoView + 光标定位；fallback：自解析 `^#{1,6} ` 构建 + 节点查找）
- [ ] Popover 打开时刷新（大纲随内容变化）

**2.4 验证门（阶段 2）**
- [ ] typecheck + build 绿
- [ ] ui-smoke 扩展：头部标签跟随、ⓘ 面板存在、大纲跳转、图片按钮 dev 路径（file input 模拟）
- [ ] 手动：按钮逐个点（无选区/有选区）、图片插入、表格快捷键

## 阶段 3：内容区细节 + 主题 + 收尾

**3.1 CSS 细节**
- [ ] 标题 # marker 字号跟随级别（先确认 IR heading DOM 结构，再写覆盖 CSS）
- [ ] 列表：padding-left 层级缩进 + marker 三级符号（disc/circle/square；ol 同理）
- [ ] 软换行验证（长行视口内换行；缺则补 white-space/word-break）
- [ ] vditor 主题变量映射项目 token（--vditor-* 浅/深两套），工具栏/内容区与 shadcn 一致；暗色切换联动验证

**3.2 回归与收尾**
- [ ] 归档只读笔记渲染回归（MarkdownView 不变）
- [ ] 实时保存回归：输入→防抖落盘→重开仍在；Ctrl+S；切换路由无草稿残留
- [ ] 搜索态/对象详情等非编辑路径回归（无 vditor 初始化）
- [ ] 全量验证：typecheck + smoke + smoke:stores + smoke:decorations + build + ui-smoke
- [ ] dist 打包检查：public/vditor 资源齐全（lute/highlight/i18n 均在 zip 内）
- [ ] 更新 spec：quality-guidelines（vditor 集成契约：cdn 本地化、非受控、dark 联动）+ journal

## 验证命令

```bash
npm run typecheck && npm run smoke && npm run smoke:stores && npm run smoke:decorations && npm run build
npm run dev &   # 5173
npm run ui-smoke
```

## 评审门 / 回滚点

- 阶段 1 末：引擎替换完成、ui-smoke 全绿 → 里程碑提交；此后各阶段独立提交
- 阶段 2 末：布局/工具栏/元信息完成 → 用户 uTools 实测反馈再进阶段 3
- 数据零迁移（markdown 纯文本），任意阶段可回退上一提交
