# Design — 侧边栏视图栏重构 + 新建笔记小窗 + 顶栏简化

## 1. 布局总览

```
┌───────────┬───────────────────────────┐
│ h-11 视图栏│ h-11 内容区顶栏（等高对齐） │ ← R6
│ [首页|标签| │  [Badge 标题 笔记数 排序 ℹ 新笔记] │ ← R5
│  归档]     │                          │
│ 活跃对象…  │  内容区（Dialog 小窗/表单） │
│           │                          │
│  ⚙ (底部)  │                          │ ← R3 齿轮
└───────────┴───────────────────────────┘
   w-44（#f0f0f0）     纯白
```

## 2. 侧边栏视觉（R1/R2/R6）

| 文件 | 改动 |
|---|---|
| `src/index.css` | `--sidebar: #fafafa → #f0f0f0`（浅色）；暗色 `#1f1f1f` 不动 |
| `src/App.tsx` | `aside` `w-48 → w-44`；视图容器 `p-2 pb-1.5` → `flex h-11 items-center px-2`（与 ContentHeader h-11 顶部平齐）；SidebarList 下方加 `mt-auto` 齿轮区 |
| `src/components/ViewSwitcher.tsx` | VIEWS 去 settings；TabsList `bg-transparent p-0`（覆盖 default variant 的 bg-muted）；TabsTrigger：`h-8 px-1 text-[0.9rem]` + `hover:bg-accent/60`（保留 data-active:bg-background 白底选中）；移除 requestRoute 相关残留注释 |
| `src/stores/ui.ts` | 加 `lastBrowseView: View`（`'home' \| 'tags' \| 'archived'`）：`setView` 时若目标非 settings 则记录；View 类型不变（settings 仍存在） |
| `src/components/SidebarList.tsx` | settings 分支改为按 `lastBrowseView` 渲染对应列表（复用三分支），删 Empty 空态 |
| 新 `SidebarSettingsButton`（可放 ViewSwitcher 内或 App 内） | 圆形 icon 按钮：`size-8 rounded-full`、`hover:bg-accent`、`view==='settings'` 时 `bg-accent text-accent-foreground`、`aria-label="设置"` |

## 3. 右键删除悬停（R4）

`src/components/ui/context-menu.tsx` ContextMenuItem：
```
data-[variant=destructive]:text-destructive
→ data-[variant=destructive]:text-destructive
   focus:data-[variant=destructive]:bg-destructive
   focus:data-[variant=destructive]:text-destructive-foreground
```
全红底白字，与 AlertDialog 删除按钮风格一致（`bg-destructive text-destructive-foreground`）。

## 4. 对象详情顶栏简化（R5）

`ContentHeader.tsx` ObjectHeaderActions：

- 删除：元数据圆角块（`meta` 渲染段）
- 删除：归档 icon / 编辑 icon / 删除 icon / 恢复按钮（readonly 分支）
- 保留：Badge + 标题 + 笔记数 + 排序菜单 + 新笔记按钮（readonly 时隐藏）
- 新增 ℹ 元数据查看：
  ```tsx
  {hasMeta && (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" className="rounded-full" aria-label="查看元数据">
          <InfoIcon data-icon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        {/* author/year/url 图标行，样式复用原元数据块内联结构 */}
      </PopoverContent>
    </Popover>
  )}
  ```
- 操作区顺序（从左到右）：排序 → ℹ → 新笔记（新笔记最右）
- 归档对象：只读 badge + 排序 + ℹ（新笔记隐藏）

`hasMeta = !!(meta?.author || meta?.url || meta?.year)`。

## 5. 顶栏对齐（R6）

`ContentHeader.tsx`：所有顶栏分支保持 `h-11`（编辑态/通用/对象详情），标题字号 `text-sm → text-[0.9rem]`；App 视图容器改为 `h-11` 垂直居中 → 两边顶部平齐、高度一致。

## 6. 笔记表单小窗（R7）

### 6.1 路由

`ContentArea.tsx`：
```
editing.kind === 'object' → <ObjectForm />（保持全内容区）
editing.kind === 'note'   → <NoteFormDialog />（新组件，Dialog 承载）
```

### 6.2 NoteFormDialog（新组件）

```tsx
export default function NoteFormDialog() {
  const editing = useUiStore((s) => s.editing)
  const stopEditing = useUiStore((s) => s.stopEditing)
  return (
    <Dialog open={editing?.kind === 'note'} onOpenChange={(o) => { if (!o) stopEditing() }}>
      <DialogContent className="sm:max-w-md" onEscapeKeyDown={...}>
        <DialogHeader><DialogTitle>{editing?.id ? '编辑笔记' : '新建笔记'}</DialogTitle></DialogHeader>
        <NoteFormFields />   {/* 原 NoteForm 字段区（标题+标签+兜底对象选择），去掉外层 flex-1 容器 */}
      </DialogContent>
    </Dialog>
  )
}
```

### 6.3 NoteForm 拆分

NoteForm 现有外层结构 `flex min-h-0 flex-1 flex-col` + 底部操作栏 `bg-muted/50` —— 抽 `NoteFormFields`（字段部分）供 Dialog 复用；保存/取消按钮放 Dialog 内底部（`DialogFooter`），**取消 = stopEditing 直接关窗**（无 dirty 确认，上一任务已删 DirtyGuard）。保存成功逻辑不变（create/update + selectObject + stopEditing）。

Dialog 关闭清理：`onOpenChange(false)` → stopEditing（含 Esc/遮罩点击）。保存进行中禁用按钮（现有 saving state 保留）。

### 6.4 标签联想 bug（R8）

`TagInput.tsx` onChange：
```tsx
onChange={(e) => {
  setQuery(e.target.value)
  setActive(0)
  setOpen(true)   // 兜底：点击聚焦时 Popover 被 DismissableLayer 误关（radix 时序），输入即重开
}}
```

## 7. 兼容与回滚

- `lastBrowseView` 新增字段无迁移；旧持久化数据无影响（非持久字段）
- Dialog 化只改渲染容器，NoteForm 保存逻辑/契约不变；smoke-stores 无受影响断言
- 回滚：独立 commit 整体 revert
- 风险文件：`ContentHeader.tsx`（操作区大改）、`NoteForm.tsx`/`ContentArea.tsx`（Dialog 化）、`ui-smoke.mjs`（设置入口/恢复入口断言全换）

## 8. 权衡

- ℹ 用 Popover 而非直接展示：元数据非高频信息，按需查看，顶栏更干净（用户拍板去掉常驻块）
- 归档/编辑/删除入右键：顶栏只剩低频误触风险高的按钮被移除，高频操作（排序/新笔记）留在顶栏；右键是主动行为（用户拍板）
- TabsList 去 bg-muted：侧边栏加深后 muted 底不可辨，Tab 选中白底（bg-background）+ hover 底色提供状态反馈（R2）
- 设置视图侧边栏显示 lastBrowseView：保持"左侧导航持续可见"，与用户"点击设置左侧边栏也有内容"意图一致
