/**
 * components/ObjectDetail.tsx —— 对象详情页（design.md R11）
 *
 * 顶部 = 来源元数据条：来源类型 Badge + 标题 + sourceMeta（作者/URL/年份）+
 * 标签 chip + 操作（钉住 toggle / 编辑 / 删除 AlertDialog 级联确认，R12）。
 * 下方 = 笔记卡片列表（selectNotesByObject，时间倒序）+ [＋新笔记]（带对象上下文）。
 * 列表恒为列表形态（AC3），1 条与 N 条渲染一致，由 NoteCardList 保证。
 */
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CalendarIcon,
  LinkIcon,
  PencilIcon,
  PinIcon,
  Trash2Icon,
  UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import NoteCardList from '@/components/NoteCardList'
import TagChip from '@/components/TagChip'
import { Badge } from '@/components/ui/badge'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { sourceTypeLabel, useSourceTypes } from '@/lib/sourceTypes'
import { selectNotesByObject, useNotesStore } from '@/stores/notes'
import { useObjectsStore } from '@/stores/objects'
import { useTagsStore } from '@/stores/tags'
import { useShallow } from 'zustand/react/shallow'

import { useUiStore } from '@/stores/ui'

export default function ObjectDetail({ objectId }: { objectId: string }) {
  const object = useObjectsStore((s) => s.objects.find((o) => o._id === objectId))
  const notes = useNotesStore(useShallow((s) => selectNotesByObject(s, objectId)))
  const tags = useTagsStore((s) => s.tags)
  const sourceTypes = useSourceTypes()
  const togglePinned = useObjectsStore((s) => s.togglePinned)
  const setArchived = useObjectsStore((s) => s.setArchived)
  const removeObject = useObjectsStore((s) => s.remove)
  const selectObject = useUiStore((s) => s.selectObject)
  const startEditing = useUiStore((s) => s.startEditing)
  const requestRoute = useUiStore((s) => s.requestRoute)

  if (!object) {
    return (
      <Empty className="gap-2">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <span className="text-lg leading-none">📦</span>
          </EmptyMedia>
          <EmptyTitle>对象不存在或已删除</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  const tagChips = object.tags
    .map((id) => tags.find((t) => t._id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)
  const meta = object.sourceMeta

  const handleDelete = async () => {
    const count = await removeObject(object._id)
    toast.success(`已删除对象「${object.title}」及 ${count} 条笔记`)
    selectObject(null)
  }

  const handleArchive = async () => {
    try {
      await setArchived(object._id, true)
      toast.success(`已归档「${object.title}」（${notes.length} 条笔记转只读）`)
    } catch (err) {
      toast.error(`归档失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRestore = async () => {
    try {
      await setArchived(object._id, false)
      toast.success(`已恢复「${object.title}」（如需上首页请重新钉住）`)
    } catch (err) {
      toast.error(`恢复失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 只读语义（R4）：归档对象的详情/笔记全部不可编辑 */
  const readonly = object.archived

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 来源元数据条 */}
      <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="shrink-0">
            {sourceTypeLabel(object.sourceType, sourceTypes)}
          </Badge>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={object.title}>
            {object.title}
          </h2>
          {readonly && (
            <Badge variant="outline" className="shrink-0 text-[0.7rem] font-normal text-muted-foreground">
              已归档（只读）
            </Badge>
          )}
          {/* 操作：活跃对象 = 钉住/编辑/归档/删除；归档对象 = 仅「恢复」（R1-R3） */}
          {readonly ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm">
                  <ArchiveRestoreIcon data-icon />
                  恢复
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>恢复对象「{object.title}」？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将移回活跃列表（不会自动钉住，需重新钉住才能上首页），其下{" "}
                    {notes.length} 条笔记恢复可编辑。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleRestore()}>恢复</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <>
          <Button
            variant={object.pinned ? 'default' : 'outline'}
            size="icon-sm"
            aria-label={object.pinned ? '取消钉住' : '钉住对象'}
            title={object.pinned ? '取消钉住' : '钉住'}
            onClick={() => void togglePinned(object._id)}
            disabled={object.archived}
          >
            <PinIcon data-icon className={object.pinned ? 'fill-current' : ''} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="编辑对象"
            title="编辑"
            onClick={() => requestRoute(() => startEditing('object', object._id))}
          >
            <PencilIcon data-icon />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="归档对象"
                title="归档"
              >
                <ArchiveIcon data-icon />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>将归档「{object.title}」？</AlertDialogTitle>
                <AlertDialogDescription>
                  其下 {notes.length} 条笔记将一并转为只读。归档后可在侧边栏「归档」视图恢复。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleArchive()}>归档</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="删除对象"
                title="删除"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon data-icon />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除对象「{object.title}」？</AlertDialogTitle>
                <AlertDialogDescription>
                  将删除该对象及其下 {notes.length} 条笔记，该操作不可恢复（R12 级联删除）。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => void handleDelete()}
                >
                  删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
            </>
          )}
        </div>

        {/* 来源元数据 + 标签 */}
        {(meta?.author || meta?.url || meta?.year || tagChips.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {meta?.author && (
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <UserIcon data-icon className="size-3 shrink-0" />
                <span className="truncate">{meta.author}</span>
              </span>
            )}
            {meta?.url && (
              <a
                href={meta.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                title={meta.url}
              >
                <LinkIcon data-icon className="size-3 shrink-0" />
                <span className="max-w-40 truncate">{meta.url.replace(/^https?:\/\//, '')}</span>
              </a>
            )}
            {meta?.year && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarIcon data-icon className="size-3 shrink-0" />
                {meta.year}
              </span>
            )}
            {tagChips.length > 0 && (
              <>
                <Separator orientation="vertical" className="h-3.5" />
                <div className="flex flex-wrap items-center gap-1">
                  {tagChips.map((t) => (
                    <TagChip key={t._id} tag={t} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 笔记区标题行：计数 + 新建笔记（带对象上下文；归档只读隐藏） */}
      <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
        <span className="text-xs text-muted-foreground">笔记 · {notes.length}</span>
        {!readonly && (
          <Button size="sm" onClick={() => requestRoute(() => startEditing('note', null))}>
            <span className="text-sm leading-none">＋</span>
            新笔记
          </Button>
        )}
      </div>

      {/* 卡片列表（ScrollArea 内部滚动） */}
      <NoteCardList notes={notes} />
    </div>
  )
}
