/**
 * components/NoteView.tsx —— 笔记全文只读视图（design.md R6 第二种内容形态）
 *
 * 入口：NoteCardList 卡片点击 → ui.openNote(id)；返回：左上角返回按钮 →
 * ui.closeNote()（选中态保留，回到对象详情或标签列表）。
 * 渲染：MarkdownView 轻量只读渲染（阶段 5 编辑器完成后可复用其预览能力）。
 */
import { ArrowLeftIcon, PencilIcon } from 'lucide-react'

import MarkdownView from '@/components/MarkdownView'
import TagChip from '@/components/TagChip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatTime } from '@/lib/format'
import { useNotesStore } from '@/stores/notes'
import { useObjectsStore } from '@/stores/objects'
import { useTagsStore } from '@/stores/tags'
import { useUiStore } from '@/stores/ui'

export default function NoteView({ noteId }: { noteId: string }) {
  const note = useNotesStore((s) => s.notes.find((n) => n._id === noteId))
  const object = useObjectsStore((s) =>
    note ? s.objects.find((o) => o._id === note.objectId) : undefined,
  )
  const tags = useTagsStore((s) => s.tags)
  const closeNote = useUiStore((s) => s.closeNote)
  const selectObject = useUiStore((s) => s.selectObject)
  const startEditing = useUiStore((s) => s.startEditing)

  if (!note) {
    return (
      <Empty className="gap-2">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <span className="text-lg leading-none">📝</span>
          </EmptyMedia>
          <EmptyTitle>笔记不存在或已删除</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  /** 归档笔记只读（AC9/R13）：隐藏编辑按钮 + 只读标记 */
  const readonly = object?.archived === true

  const tagChips = note.tags
    .map((id) => tags.find((t) => t._id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部工具行：返回 + 归属对象 + 标题 + 编辑 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="返回"
          onClick={closeNote}
        >
          <ArrowLeftIcon data-icon />
        </Button>
        {object && (
          <button
            type="button"
            onClick={() => selectObject(object._id)}
            className="max-w-36 truncate rounded px-1 text-xs text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground hover:underline"
            title={object.title}
          >
            {object.title}
          </button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={note.title}>
          {note.title}
        </h2>
        {readonly && (
          <Badge variant="secondary" className="shrink-0 text-[0.7rem] font-normal">
            已归档（只读）
          </Badge>
        )}
        {!readonly && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => startEditing('note', note._id)}
          >
            <PencilIcon data-icon />
            编辑
          </Button>
        )}
      </div>

      {/* 正文区 */}
      <ScrollArea className="min-h-0 flex-1">
        <article className="flex flex-col gap-3 p-4">
          {/* 元信息行：标签 + 时间 */}
          <div className="flex flex-wrap items-center gap-1.5">
            {tagChips.map((t) => (
              <TagChip key={t._id} tag={t} />
            ))}
            <span className="ml-auto text-[0.7rem] text-muted-foreground/80">
              更新于 {formatTime(note.updatedAt)}
            </span>
          </div>

          <MarkdownView content={note.content} />
        </article>
      </ScrollArea>
    </div>
  )
}
