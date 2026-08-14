/**
 * components/NoteCardList.tsx —— 笔记卡片列表（design.md R6：全产品唯一列表形态）
 *
 * 复用点：对象详情（object 语境）、标签跨对象列表（crossObject 语境）、
 * 阶段 7 搜索结果（presorted：服务层已按 ui.sort 排好，含 relevance 相关度）。
 * **列表恒为列表形态**（AC3：1 条与 N 条渲染一致，无特判）。
 *
 * - 排序：按 ui store 的 sort（updated/created/title；relevance 阶段 7）
 * - 来源筛选：跨对象语境由调用方过滤后传入（筛选 UI 在 ContentHeader）
 * - 卡片点击 → ui.openNote 进全文；悬停显示 编辑/删除（删除走 AlertDialog 确认）
 * - 摘要取正文前 2 行并轻度剥离 Markdown 标记；标签 chip 最多 3 个 + 溢出计数
 */
import { useMemo, useState } from 'react'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import TagChip from '@/components/TagChip'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatTime } from '@/lib/format'
import { sourceTypeLabel, useSourceTypes } from '@/lib/sourceTypes'
import { useNotesStore } from '@/stores/notes'
import { useObjectsStore } from '@/stores/objects'
import { useTagsStore } from '@/stores/tags'
import { useUiStore } from '@/stores/ui'
import type { Note, NoteObject, Tag } from '@/types'

/** 摘要：正文前 2 行，剥离行首 Markdown 标记（#、-、>、数字列表） */
function excerptOf(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 2)
    .map((l) => l.replace(/^\s*(#{1,6}\s*|[-*+]\s*|\d+[.)]\s*|>\s?)/, ''))
    .join(' ')
}

interface NoteCardProps {
  note: Note
  /** 跨对象语境：显示归属对象名 + 来源角标 */
  object?: NoteObject
  /** tagId → Tag 投影（列表级一次构建，避免每卡自建） */
  tagById: Map<string, Tag>
  /** 跨对象语境的来源类型展示名（列表级计算） */
  sourceLabel?: string
  crossObject?: boolean
}
function NoteCard({ note, object, tagById, sourceLabel, crossObject }: NoteCardProps) {
  const openNote = useUiStore((s) => s.openNote)
  const startEditing = useUiStore((s) => s.startEditing)
    const removeNote = useNotesStore((s) => s.remove)
  const [confirmOpen, setConfirmOpen] = useState(false)

  /** 归档笔记只读（AC9/R14）：隐藏编辑入口，保留删除（用户拍板 2a） */
  const readonly = object?.archived === true

  const tagChips = useMemo(
    () => note.tags.map((id) => tagById.get(id)).filter((t): t is Tag => !!t),
    [note.tags, tagById],
  )
  const excerpt = useMemo(() => excerptOf(note.content), [note.content])

  const handleDelete = async () => {
    await removeNote(note._id)
    toast.success(`已删除「${note.title}」`)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openNote(note._id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        // 嵌套按钮（编辑/删除）自行处理 Enter/Space，避免冒泡重复打开笔记
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        openNote(note._id)
      }}
      className="group flex cursor-pointer flex-col gap-1 rounded-lg border border-transparent bg-muted p-2.5 hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-border dark:bg-card dark:hover:bg-accent/50"
    >
      {/* 标题行 + 悬停操作 */}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{note.title}</span>
        {/* 悬停操作：按钮常占位（opacity 切换，无过渡动画、不挤压标题布局） */}
        <span className="pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100">
          {!readonly && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="编辑笔记"
              onClick={(e) => {
                e.stopPropagation()
                startEditing('note', note._id)
              }}
            >
              <PencilIcon data-icon />
            </Button>
          )}
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="删除笔记"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2Icon data-icon />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除笔记</AlertDialogTitle>
                  <AlertDialogDescription>
                    将删除「{note.title}」，该操作不可恢复。
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
          </span>
      </div>

      {/* 摘要（前 2 行截断） */}
      {excerpt && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {excerpt}
        </p>
      )}

      {/* 底部：来源角标 + 对象名（跨对象）+ 标签 + 时间 */}
      <div className="flex items-center gap-1.5">
        {crossObject && object && (
          <Badge
            variant="outline"
            className="h-4.5 max-w-24 shrink-0 truncate rounded px-1 text-[0.7rem] font-normal text-muted-foreground"
          >
            {object.title}
          </Badge>
        )}
        {crossObject && object && sourceLabel && (
          <Badge
            variant="secondary"
            className="h-4.5 shrink-0 rounded px-1 text-[0.7rem] font-normal"
          >
            {sourceLabel}
          </Badge>
        )}
        {object?.archived && (
          <Badge
            variant="outline"
            className="h-4.5 shrink-0 rounded px-1 text-[0.7rem] font-normal text-muted-foreground"
          >
            已归档
          </Badge>
        )}
        {tagChips.slice(0, 3).map((t) => (
          <TagChip key={t._id} tag={t} className="h-4.5 px-1 text-[0.7rem]" />
        ))}
        {tagChips.length > 3 && (
          <span className="shrink-0 text-[0.7rem] text-muted-foreground">
            +{tagChips.length - 3}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[0.7rem] text-muted-foreground/80">
          {formatTime(note.updatedAt)}
        </span>
      </div>
    </div>
  )
}

export default function NoteCardList({
  notes,
  crossObject = false,
  presorted = false,
}: {
  notes: Note[]
  /** 跨对象语境（标签视图/搜索结果）：卡片展示对象名；对象详情语境为 false */
  crossObject?: boolean
  /** 搜索结果：调用方已按 ui.sort 排好（含 relevance 相关度），跳过列表内排序 */
  presorted?: boolean
}) {
  const sort = useUiStore((s) => s.sort)
  const objects = useObjectsStore((s) => s.objects)
  const tags = useTagsStore((s) => s.tags)
  const sourceTypes = useSourceTypes()

  const objectById = useMemo(() => new Map(objects.map((o) => [o._id, o])), [objects])
  const tagById = useMemo(() => new Map(tags.map((t) => [t._id, t])), [tags])
  const sourceLabelOf = (id: string) => sourceTypeLabel(id, sourceTypes)

  /** 排序（R17）：presorted 时跳过（搜索结果由服务层排序）；否则 updated 倒序 / created 倒序 / title 字典序（zh-CN） */
  const sorted = useMemo(() => {
    if (presorted) return notes
    const arr = [...notes]
    if (sort === 'title') {
      arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    } else if (sort === 'created') {
      arr.sort((a, b) => b.createdAt - a.createdAt)
    } else {
      arr.sort((a, b) => b.updatedAt - a.updatedAt)
    }
    return arr
  }, [notes, sort, presorted])

  if (sorted.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Empty className="gap-2">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <span className="text-lg leading-none">📝</span>
            </EmptyMedia>
            <EmptyTitle>还没有笔记</EmptyTitle>
            <EmptyDescription>点击顶栏「新笔记」记录第一条要点</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-2 p-3">
        {sorted.map((n) => {
          const obj = objectById.get(n.objectId)
          return (
            <NoteCard
              key={n._id}
              note={n}
              object={obj}
              sourceLabel={crossObject && obj ? sourceLabelOf(obj.sourceType) : undefined}
              tagById={tagById}
              crossObject={crossObject}
            />
          )
        })}
      </div>
    </ScrollArea>
  )
}
