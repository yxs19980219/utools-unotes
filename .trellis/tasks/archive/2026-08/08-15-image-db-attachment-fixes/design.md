# Design —— 图片存 db 附件 + 待办变灰 + 列表缩进

## 1. 总览

```
┌──────────────────────────────────────────────────────────┐
│ P1 图片附件（AtomicEditor.tsx paste + patch image-blocks） │
│   粘贴 → postAttachment(img/<uuid>) → ![图片](utools-db://) │
│   渲染 → getAttachment → Blob → objectURL（patch）          │
├──────────────────────────────────────────────────────────┤
│ P2 待办变灰（atomicTheme.css）                             │
│   checkbox:checked 灰 + task-done 去行背景                 │
├──────────────────────────────────────────────────────────┤
│ P3 列表缩进（atomicTheme.css）                             │
│   .cm-atomic-list-marker min-width 固定                    │
└──────────────────────────────────────────────────────────┘
```

## 2. P1 图片附件（核心）

### 写入（src/components/Editor/AtomicEditor.tsx paste handler）

```
uTools 环境（utools?.db?.promises?.postAttachment 存在）：
  file → arrayBuffer() → postAttachment(`img/${crypto.randomUUID()}`, buffer, file.type)
  → 成功：dispatch 插入 `![图片](utools-db://img/<uuid>)`，光标末尾
  → 失败（超 10M/其他）：toast.error，不插入
浏览器环境（dev/headless）：现状 data URL 降级（可显示）
```

- `utools-db://` 前缀避免与合法 URL scheme 冲突（file/http/data 均不同）。
- id 完整即 `img/<uuid>`，与 db 文档 _id 一致，无二次映射。

### 渲染（patch node_modules/@atomic-editor/editor/dist/image-blocks.js）

ImageWidget.toDOM 中 img.src 赋值处扩展：

```js
toDOM(view) {
  ...
  const img = document.createElement('img')
  const dbId = this.src.startsWith('utools-db://')
    ? this.src.slice('utools-db://'.length)
    : null
  if (dbId && globalThis.utools?.db?.promises?.getAttachment) {
    // 附件引用：异步读 db → Blob → objectURL（空 src 占位，避免加载失败图标）
    utools.db.promises.getAttachment(dbId).then((buf) => {
      const blob = new Blob([buf], { type: 'image/png' })
      img.src = URL.createObjectURL(blob)
    }).catch(() => {})
    img.dataset.dbId = dbId
  } else {
    img.src = this.src   // 常规路径/data URL；非 uTools 环境 utools-db:// 不设 src（占位）
  }
  ...
}
```

- Blob type：getAttachment 无 mime 返回，统一 image/png 会令 JPEG 解码失败（type 仅影响解码提示，Chromium 按内容嗅探，可省略或省略 type 参数）。
- objectURL 不 revoke（图片数量有限，生命周期=应用会话）。
- dimensionCache key 用 this.src（utools-db:// 引用稳定）→ 尺寸缓存有效。
- eq() 不变（src 比较即引用比较）。

### 边界
- 附件 doc 与笔记 doc 独立；删除笔记/编辑图片不清理附件（孤儿接受，spec 记录）。
- 跨设备同步：附件随 db 同步（postAttachment 是 db 文档），utools-db:// 引用在其他设备可渲染。
- 10M 上限：postAttachment 返回 `ok: false` → toast。
- readOnly 归档笔记：粘贴不触发（现有 readOnly 守卫）。

## 3. P2 待办完成态（atomicTheme.css）

```css
/* 框体变灰（覆盖 inline-preview.css 的 accent 黑） */
.cm-atomic-task-checkbox:checked {
  background: var(--muted-foreground);
  border-color: var(--muted-foreground);
}
/* 完成行：去掉整行灰底，保留文字灰 + 删除线 */
.cm-line.cm-atomic-task-done {
  color: var(--muted-foreground);
  text-decoration: line-through;
}
```
- 勾号（::after 白色）在灰底上对比度 OK。
- 未完成态不动。

## 4. P3 列表缩进（atomicTheme.css）

根因（已实测）：inline-block 的 `min-width: auto` 规则使 width 首选宽度被内容撑开，
marker 实际宽度 = 字符宽度（○ 缩小后 10.8px vs ● 15.3px）→ 文字起点缩进各级不一致
（实测 1→2 级 14.3px、2→3 级 26.5px，应 22.2px 统一）。

```css
.cm-atomic-list-marker {
  min-width: 0.9em;   /* 强制固定 alcove 宽度（原始 width 失效的修复） */
}
```
- 字符（●○▪）实际宽均 < 0.9em（17.1px），text-align: right 右对齐，无裁剪。
- 有序列表数字/checkbox 同 class 同规则，一并统一。
- 缩进量保持现状（LIST_LEVEL_EM = 1.2em patch 值，实测每级 ≈21px），只对齐文字起点。

## 5. 兼容性与风险

- P1 渲染 patch 只在 src 前缀命中时走 db 分支，现有图片零影响；非 uTools 环境不设 src 显示占位。
- P2/P3 纯 CSS 覆盖，可整体回滚。
- 风险 R1：getAttachment 在 uTools 某些版本返回 Uint8Array 之外类型（Buffer）→ Blob 构造兼容 Uint8Array/Buffer/ArrayBuffer（`buf instanceof ArrayBuffer ? buf : (buf as any).buffer ?? buf`）。
- 风险 R2：dev/headless 中 mock utools 验证渲染（注入 window.utools 假实现）。
- 风险 R3：patch 文件更新遵循既有硬规则（hunk 升序、LF、`git apply --reverse --check` 验证）。
