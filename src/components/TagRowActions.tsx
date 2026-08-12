/**
 * components/TagRowActions.tsx —— 标签行操作（阶段 6：标签详情操作，R15）
 *
 * 交互（标签视图与首页「钉住标签」区共用，保持一致）：
 * - 行悬停显示 ⋯ 菜单（DropdownMenu 分组）：编辑别名 / 钉住·取消钉住 / 删除标签
 * - 编辑别名：Dialog 表单（规范名 + 别名每行一个）。保存前做别名冲突归并校验
 *   （findTagConflicts：新 name/aliases 精确命中其他标签的 name/aliases → 拒绝并提示；
 *   阶段 2 遗留确认的规则，本轮定稿）。保存后所有引用处显示新规范名
 *   （引用存 tagId，TagChip 读 store 映射，无需遍历，O(1)）
 * - 删除：AlertDialog 确认（提示将清理所有笔记/对象上的引用），走 tags.remove 编排；
 *   若删除的是当前选中标签 → selectTag(null) 清内容区
 */
import { useState } from 'react'
import { MoreHorizontalIcon, PencilIcon, PinIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { findTagConflicts } from '@/services/tagNormalize'
import { useTagsStore } from '@/stores/tags'
import { useUiStore } from '@/stores/ui'
import type { ReactNode } from 'react'
import type { Tag } from '@/types'

/** 编辑标签表单（Dialog 内容；Dialog 关闭即 unmount，打开时重新以最新 tag 初始化） */
export function TagEditDialog({
  tag,
  onOpenChange,
}: {
  tag: Tag
  onOpenChange(open: boolean): void
}) {
  const allTags = useTagsStore((s) => s.tags)
  const update = useTagsStore((s) => s.update)
  const [name, setName] = useState(tag.name)
  const [aliasesText, setAliasesText] = useState(tag.aliases.join('\n'))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const newName = name.trim()
    if (!newName) {
      setError('规范名不能为空')
      return
    }
    // 别名：每行一个，去空 + 大小写不敏感去重（保留首个写法）
    const aliases: string[] = []
    const seen = new Set<string>()
    for (const line of aliasesText.split(/\r?\n/)) {
      const a = line.trim()
      if (!a) continue
      const k = a.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      aliases.push(a)
    }
    // 冲突归并规则（定稿）：新 name/aliases 精确命中其他标签 → 拒绝并提示
    const conflicts = findTagConflicts(tag._id, newName, aliases, allTags)
    if (conflicts.length > 0) {
      const usedValues = new Set([newName, ...aliases].map((v) => v.toLowerCase()))
      const clash = conflicts
        .flatMap((t) => [t.name, ...t.aliases])
        .find((v) => usedValues.has(v.toLowerCase()))
      const owner = conflicts.find((t) =>
        [t.name, ...t.aliases].some((v) => usedValues.has(v.toLowerCase())),
      )
      setError(`「${clash ?? ''}」已属于标签「${owner?.name ?? ''}」，请修改后再保存`)
      return
    }
    setSaving(true)
    setError('')
    try {
      await update({ ...tag, name: newName, aliases })
      toast.success(`标签已更新为「${newName}」`)
      onOpenChange(false)
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>编辑标签</DialogTitle>
        <DialogDescription>
          修改规范名与别名。引用该标签的笔记将自动显示新名称（引用存 tagId，无需遍历）。
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void handleSave()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tag-edit-name" className="text-xs font-medium text-muted-foreground">
            规范名
          </label>
          <Input
            id="tag-edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：深度学习"
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tag-edit-aliases" className="text-xs font-medium text-muted-foreground">
            别名（每行一个）
          </label>
          <Textarea
            id="tag-edit-aliases"
            value={aliasesText}
            onChange={(e) => setAliasesText(e.target.value)}
            rows={4}
            placeholder={'deep learning\nDL'}
          />
          <p className="text-xs text-muted-foreground">
            输入别名时联想与归并均会命中；与其他标签冲突将拒绝保存
          </p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={saving}>
              取消
            </Button>
          </DialogClose>
          <Button size="sm" type="submit" disabled={saving || !name.trim()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** 删除标签确认（⋯ 下拉与右键菜单共用：受控 AlertDialog + 删除编排） */
function useTagDelete(tagId: string, tagName: string) {
  const remove = useTagsStore((s) => s.remove)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await remove(tagId)
      toast.success(`已删除标签「${tagName}」，并清理所有笔记/对象上的引用`)
      // 删除当前选中标签 → 清内容区（避免残留空列表态）
      if (useUiStore.getState().selectedTagId === tagId) {
        useUiStore.getState().selectTag(null)
      }
      setDeleteOpen(false)
    } catch (err) {
      toast.error(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDeleting(false)
    }
  }

  return { deleteOpen, setDeleteOpen, deleting, handleDelete }
}

export default function TagRowActions({ tagId }: { tagId: string }) {
  const tag = useTagsStore((s) => s.tags.find((t) => t._id === tagId))
  const togglePinned = useTagsStore((s) => s.togglePinned)
  const [editOpen, setEditOpen] = useState(false)
  const { deleteOpen, setDeleteOpen, deleting, handleDelete } = useTagDelete(tagId, tag?.name ?? '')

  if (!tag) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="标签操作"
            title="标签操作"
            className="text-muted-foreground"
          >
            <MoreHorizontalIcon data-icon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <PencilIcon data-icon />
            编辑别名
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void togglePinned(tag._id)}>
            <PinIcon data-icon className={tag.pinned ? 'fill-current' : ''} />
            {tag.pinned ? '取消钉住' : '钉住'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2Icon data-icon />
            删除标签
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 编辑别名（受控 Dialog：关闭后 Radix 自动 unmount 内容，打开时以最新 tag 初始化表单） */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <TagEditDialog tag={tag} onOpenChange={setEditOpen} />
      </Dialog>

      {/* 删除确认：提示将清理所有笔记/对象上的引用（走 tags.remove 编排） */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除标签「{tag.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将从所有笔记与对象中移除该标签引用，该操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? '删除中…' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * 钉住标签行右键菜单（与活跃对象行交互一致：右键弹出；菜单项与 ⋯ 下拉相同）。
 * 使用受控 Dialog/AlertDialog（state 提升，避免 ContextMenu 与 Dialog 焦点冲突）。
 */
export function TagContextMenu({ tagId, children }: { tagId: string; children: ReactNode }) {
  const tag = useTagsStore((s) => s.tags.find((t) => t._id === tagId))
  const togglePinned = useTagsStore((s) => s.togglePinned)
  const [editOpen, setEditOpen] = useState(false)
  const { deleteOpen, setDeleteOpen, deleting, handleDelete } = useTagDelete(tagId, tag?.name ?? '')

  if (!tag) return null

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-36">
          <ContextMenuItem onSelect={() => setEditOpen(true)}>
            <PencilIcon data-icon />
            编辑别名
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void togglePinned(tag._id)}>
            <PinIcon data-icon className={tag.pinned ? 'fill-current' : ''} />
            {tag.pinned ? '取消钉住' : '钉住'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2Icon data-icon />
            删除标签
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* 编辑别名（与 ⋯ 下拉共用表单） */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <TagEditDialog tag={tag} onOpenChange={setEditOpen} />
      </Dialog>

      {/* 删除确认（与 ⋯ 下拉共用编排） */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除标签「{tag.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将从所有笔记与对象中移除该标签引用，该操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? '删除中…' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
