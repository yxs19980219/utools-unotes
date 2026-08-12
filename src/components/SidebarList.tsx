/**
 * components/SidebarList.tsx —— 侧边栏视图列表区（三期：对象一维状态 + 右键菜单）
 *
 * - 首页：「活跃对象」分组（全部 !archived，updatedAt 倒序；分组标题右侧 + = 新建对象）
 *   + 「钉住标签」分组（主题维度，保留）；点击 → selectObject/selectTag
 * - 对象行右键菜单（ContextMenu）：活跃 = 编辑/归档/删除；归档视图 = 恢复/删除
 *   （删除/归档/恢复均 AlertDialog 确认，删除提示级联笔记数）
 * - 标签：全部标签（name + 计数 Badge），点击 → selectTag，高亮联动
 * - 归档：已归档对象列表（标题 + 来源图标 + 归档时间，按归档时间倒序）
 * - 设置：空态占位（内容区为 SettingsView）
 * 路由切换（selectObject/selectTag/startEditing）直接调用（实时保存时代无确认）。
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  TagIcon,
  Trash2Icon,
} from 'lucide-react'

import SidebarRow from '@/components/SidebarRow'
import TagRowActions from '@/components/TagRowActions'
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
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTime } from '@/lib/format'
import {
  archiveObject,
  removeObjectWithToast,
  restoreObject,
} from '@/lib/objectActions'
import { sourceTypeIcon } from '@/lib/sourceTypes'
import { selectNotesByObject, useNotesStore } from '@/stores/notes'
import { selectActiveObjects, selectArchivedObjects, useObjectsStore } from '@/stores/objects'
import { countNotesByTag, selectPinnedTags, useTagsStore } from '@/stores/tags'
import { useUiStore } from '@/stores/ui'
import { useShallow } from 'zustand/react/shallow'
import type { NoteObject, Tag } from '@/types'

/** 标签行（悬停 ⋯ 操作 + 选中高亮；首页钉住区与标签视图共用，交互一致） */
function TagSidebarRow({
  tag,
  badge,
  active,
  onClick,
}: {
  tag: Tag
  badge?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <SidebarRow
      icon={<TagIcon />}
      label={tag.name}
      badge={badge}
      active={active}
      onClick={onClick}
      actions={<TagRowActions tagId={tag._id} />}
    />
  )
}

/** 分组小标题（支持右侧 action，如「活跃对象」的 + 新建按钮） */
function SectionLabel({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1.5 pt-2 pb-1">
      <span className="text-xs font-medium text-muted-foreground/80">{children}</span>
      {action}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-7 w-full rounded-md" />
      ))}
    </div>
  )
}

/** 对象行右键菜单（三期：对象级操作收敛于此）：
 *  活跃对象 = 编辑/归档/删除；归档对象 = 恢复/删除。
 *  确认框用受控 AlertDialog（state 提升，避免 ContextMenu 与 Dialog 焦点冲突）。 */
function ObjectContextMenu({
  object,
  mode,
  children,
}: {
  object: NoteObject
  mode: 'active' | 'archived'
  children: ReactNode
}) {
  const startEditing = useUiStore((s) => s.startEditing)
    const notes = useNotesStore(useShallow((s) => selectNotesByObject(s, object._id)))
  /** 当前确认框类型（null = 关闭） */
  const [dialog, setDialog] = useState<'archive' | 'restore' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)

  const noteCount = notes.length

  const handleArchive = async () => {
    setBusy(true)
    const ok = await archiveObject(object._id)
    if (ok) setDialog(null)
    setBusy(false)
  }

  const handleRestore = async () => {
    setBusy(true)
    const ok = await restoreObject(object._id)
    if (ok) setDialog(null)
    setBusy(false)
  }

  const handleDelete = async () => {
    setBusy(true)
    const count = await removeObjectWithToast(object._id)
    if (count >= 0) setDialog(null)
    setBusy(false)
  }

  const dialogContent =
    dialog === 'archive' ? (
      {
        title: `将归档「${object.title}」？`,
        desc: `其下 ${noteCount} 条笔记将一并转为只读。归档后可在侧边栏「归档」视图恢复。`,
        action: '归档',
      }
    ) : dialog === 'restore' ? (
      {
        title: `恢复对象「${object.title}」？`,
        desc: `将移回活跃列表，其下 ${noteCount} 条笔记恢复可编辑。`,
        action: '恢复',
      }
    ) : dialog === 'delete' ? (
      {
        title: `删除对象「${object.title}」？`,
        desc: `将删除该对象及其下 ${noteCount} 条笔记，该操作不可恢复。`,
        action: '删除',
      }
    ) : null

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-36">
        {mode === 'active' && (
          <>
            <ContextMenuItem
              onSelect={() => startEditing('object', object._id)}
            >
              <PencilIcon data-icon />
              编辑
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setDialog('archive')}>
              <ArchiveIcon data-icon />
              归档
            </ContextMenuItem>
          </>
        )}
        {mode === 'archived' && (
          <ContextMenuItem onSelect={() => setDialog('restore')}>
            <ArchiveRestoreIcon data-icon />
            恢复
          </ContextMenuItem>
        )}
        {mode === 'active' && <ContextMenuSeparator />}
        <ContextMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
          <Trash2Icon data-icon />
          删除
        </ContextMenuItem>
      </ContextMenuContent>

      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogContent?.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialogContent?.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={dialog === 'delete' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
              onClick={() => {
                if (dialog === 'archive') void handleArchive()
                if (dialog === 'restore') void handleRestore()
                if (dialog === 'delete') void handleDelete()
              }}
            >
              {dialogContent?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ContextMenu>
  )
}

/** 首页：活跃对象（全部 !archived）+ 钉住标签，点击联动 selectObject/selectTag */
function HomeSidebarGroups() {
  const objectsLoaded = useObjectsStore((s) => s.loaded)
  const tagsLoaded = useTagsStore((s) => s.loaded)
  const loaded = objectsLoaded && tagsLoaded
  const activeObjects = useObjectsStore(useShallow(selectActiveObjects))
  const pinnedTags = useTagsStore(useShallow(selectPinnedTags))
  const selectedObjectId = useUiStore((s) => s.selectedObjectId)
  const selectedTagId = useUiStore((s) => s.selectedTagId)
  const selectObject = useUiStore((s) => s.selectObject)
  const selectTag = useUiStore((s) => s.selectTag)
    const startEditing = useUiStore((s) => s.startEditing)
  // 活跃对象按更新时间倒序（最新改动在前）
  const sortedObjects = useMemo(
    () => [...activeObjects].sort((a, b) => b.updatedAt - a.updatedAt),
    [activeObjects],
  )

  if (!loaded) return <ListSkeleton />
  if (sortedObjects.length === 0 && pinnedTags.length === 0) {
    return (
      <Empty className="gap-2 p-3">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PinIcon />
          </EmptyMedia>
          <EmptyTitle>还没有对象</EmptyTitle>
          <EmptyDescription>创建你的第一个学习对象（书籍 / 视频 / 项目…）</EmptyDescription>
        </EmptyHeader>
        <Button size="sm" onClick={() => startEditing('object', null)}>
          <PlusIcon data-icon />
          新建对象
        </Button>
      </Empty>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5">
      {/* 活跃对象：上半区（与钉住标签对半分；内容多时随外层 ScrollArea 整体滚动） */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 pb-2">
        <SectionLabel
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="新建对象"
                  title="新建对象"
                  onClick={() => startEditing('object', null)}
                >
                  <PlusIcon data-icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">新建对象</TooltipContent>
            </Tooltip>
          }
        >
          活跃对象
        </SectionLabel>
        {sortedObjects.map((o) => {
          const Icon = sourceTypeIcon(o.sourceType)
          return (
            <ObjectContextMenu key={o._id} object={o} mode="active">
              <SidebarRow
                icon={<Icon />}
                label={o.title}
                active={selectedObjectId === o._id}
                onClick={() => selectObject(o._id)}
              />
            </ObjectContextMenu>
          )
        })}
      </div>
      {/* 钉住标签：下半区（对半分；无钉住标签时不渲染） */}
      {pinnedTags.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          <SectionLabel>钉住标签</SectionLabel>
          {pinnedTags.map((t) => (
            <TagSidebarRow
              key={t._id}
              tag={t}
              active={selectedTagId === t._id}
              onClick={() => selectTag(t._id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** 标签视图：全部标签 + 计数（R8），点击 → selectTag */
function TagsSidebarList() {
  const loaded = useTagsStore((s) => s.loaded)
  const tags = useTagsStore((s) => s.tags)
  const notes = useNotesStore((s) => s.notes)
  const selectedTagId = useUiStore((s) => s.selectedTagId)
    const selectTag = useUiStore((s) => s.selectTag)
  const counts = useMemo(() => countNotesByTag(tags, notes), [tags, notes])
  const sorted = useMemo(
    () => [...tags].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [tags],
  )

  if (!loaded) return <ListSkeleton />
  if (sorted.length === 0) {
    return (
      <Empty className="gap-2 p-3">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TagIcon />
          </EmptyMedia>
          <EmptyTitle>还没有标签</EmptyTitle>
          <EmptyDescription>新建笔记时输入标签即可创建</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      {sorted.map((t) => (
        <TagSidebarRow
          key={t._id}
          tag={t}
          badge={counts.get(t._id) ?? 0}
          active={selectedTagId === t._id}
          onClick={() => selectTag(t._id)}
        />
      ))}
    </div>
  )
}

/** 归档视图：已归档对象列表（标题 + 来源图标 + 归档时间，按归档时间倒序，R1） */
function ArchivedSidebarList() {
  const loaded = useObjectsStore((s) => s.loaded)
  const archivedObjects = useObjectsStore(useShallow(selectArchivedObjects))
  const selectedObjectId = useUiStore((s) => s.selectedObjectId)
    const selectObject = useUiStore((s) => s.selectObject)
  // 归档时间 = setArchived 时的 updatedAt（update 自动 touch）；最新归档在前
  const sorted = useMemo(
    () => [...archivedObjects].sort((a, b) => b.updatedAt - a.updatedAt),
    [archivedObjects],
  )

  if (!loaded) return <ListSkeleton />
  if (sorted.length === 0) {
    return (
      <Empty className="gap-2 p-3">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ArchiveIcon />
          </EmptyMedia>
          <EmptyTitle>还没有归档对象</EmptyTitle>
          <EmptyDescription>在对象行右键选择「归档」，对象及笔记将移入此处（只读）</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      {sorted.map((o) => {
        const Icon = sourceTypeIcon(o.sourceType)
        return (
          <ObjectContextMenu key={o._id} object={o} mode="archived">
            <SidebarRow
              icon={<Icon />}
              label={o.title}
              trailing={formatTime(o.updatedAt)}
              active={selectedObjectId === o._id}
              onClick={() => selectObject(o._id)}
            />
          </ObjectContextMenu>
        )
      })}
    </div>
  )
}

export default function SidebarList() {
  // R3：设置视图时侧边栏回显进入设置前的浏览视图列表（非空）
  const browseView = useUiStore((s) => (s.view === 'settings' ? s.lastBrowseView : s.view))

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex min-h-full flex-col p-2">
        {browseView === 'home' && <HomeSidebarGroups />}
        {browseView === 'tags' && <TagsSidebarList />}
        {browseView === 'archived' && <ArchivedSidebarList />}
      </div>
    </ScrollArea>
  )
}
