/**
 * components/NoteView.tsx —— 笔记详情页（design.md R6 第二种内容形态）
 *
 * 产品语义（用户确认）：
 * - 创建笔记时不给正文，点击卡片进入此处写内容
 * - 正文为空 → 直接内联 CodeMirror 即时渲染编辑器（可写即所见）
 * - 正文非空 → 只读渲染 + 「写正文」切换编辑器；Ctrl+S / 保存按钮落库
 * - 编辑态顶部一行 Markdown 快捷工具栏（19 项插入，见 MarkdownToolbar）
 * - 标题/标签编辑低频：走卡片右侧操作（NoteCard 悬停「编辑」→ NoteForm），
 *   详情页不再放编辑按钮；「更新于」不单独占行（空间紧张），标签随正文区展示
 * - 归档笔记（AC9/R13）：纯只读，无任何编辑入口
 * - 草稿保护（R11）：正文编辑中未保存改动自动暂存 localStorage（防抖 500ms），
 *   重新进入恢复 + toast；切走经 DirtyGuard 确认（放弃/取消，AC8/AC9）
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowLeftIcon, PencilIcon, SaveIcon } from 'lucide-react'
import { toast } from 'sonner'

import CodeMirrorEditor, {
  type MarkdownInsertApi,
} from '@/components/Editor/CodeMirrorEditor'
import MarkdownToolbar from '@/components/Editor/MarkdownToolbar'
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

/** 正文草稿 localStorage key（R11：`sn:draft:<noteId>`） */
const DRAFT_PREFIX = 'sn:draft:'
const draftKey = (noteId: string) => `${DRAFT_PREFIX}${noteId}`

function readDraft(noteId: string): string | null {
  try {
    return localStorage.getItem(draftKey(noteId))
  } catch {
    return null
  }
}

function writeDraft(noteId: string, content: string): void {
  try {
    localStorage.setItem(draftKey(noteId), content)
  } catch {
    /* 存储不可用时静默降级（草稿保护尽力而为） */
  }
}

function clearDraft(noteId: string): void {
  try {
    localStorage.removeItem(draftKey(noteId))
  } catch {
    /* ignore */
  }
}

export default function NoteView({ noteId }: { noteId: string }) {
  const note = useNotesStore((s) => s.notes.find((n) => n._id === noteId))
  const object = useObjectsStore((s) =>
    note ? s.objects.find((o) => o._id === note.objectId) : undefined,
  )
  const tags = useTagsStore((s) => s.tags)
  const closeNote = useUiStore((s) => s.closeNote)
  const setPendingDirty = useUiStore((s) => s.setPendingDirty)
  const requestRoute = useUiStore((s) => s.requestRoute)
  const updateNote = useNotesStore((s) => s.update)

  /** 归档笔记只读（AC9/R13）：隐藏编辑入口 */
  const readonly = object?.archived === true

  /** 正文编辑态：空正文默认直接进入；非空经「写正文」按钮进入 */
  const [editingBody, setEditingBody] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // 编辑器插入 API（state 驱动：ref 变化不触发渲染，工具栏需要实时拿到实例）
  const [editorApi, setEditorApi] = useState<MarkdownInsertApi | null>(null)
  // 草稿防抖定时器（R11）
  const draftTimerRef = useRef<number | null>(null)

  /** 编辑器可见（空正文恒进编辑；非空经「写正文」进入）；归档只读排除 */
  const editingActive = !readonly && (editingBody || !note?.content)

  /** 进入时恢复上次未保存的草稿（R11：重新进入该笔记 → 草稿恢复 + 提示） */
  useEffect(() => {
    const saved = readDraft(noteId)
    const current = useNotesStore.getState().getById(noteId)?.content ?? ''
    if (saved !== null && saved !== current) {
      setDraft(saved)
      toast.info('已恢复未保存的草稿')
    }
  }, [noteId])

  /** 草稿防抖落盘（500ms）：编辑中且未保存改动时写入 localStorage */
  useEffect(() => {
    const note = useNotesStore.getState().getById(noteId)
    if (!note || !editingActive) return
    if (draft === note.content) return
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current)
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null
      writeDraft(noteId, draft)
    }, 500)
  }, [draft, editingActive, noteId])

  /** dirty 标志：编辑中且有实际改动 → 路由切换先确认（DirtyGuard） */
  useEffect(() => {
    const note = useNotesStore.getState().getById(noteId)
    if (!note) return
    const dirty = editingActive && draft !== note.content
    if (dirty) {
      // onDiscard：用户选「放弃」时清除已落盘草稿
      setPendingDirty(true, () => clearDraft(noteId))
    } else {
      setPendingDirty(false)
    }
  }, [draft, editingActive, noteId, setPendingDirty])

  /** 卸载清理：清防抖定时器；非放弃路径（保存后退出）清 dirty 标志 */
  useEffect(() => {
    return () => {
      if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current)
      setPendingDirty(false)
    }
  }, [setPendingDirty])

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

  /** 空正文直接进入编辑（可写即所见）；非空且未点编辑 → 只读 */
  const showEditor = editingActive

  const enterEdit = () => {
    // 有未落盘/已落盘的草稿则恢复（与挂载时恢复逻辑一致）
    const saved = readDraft(noteId)
    setDraft(saved !== null && saved !== note.content ? saved : note.content)
    setEditingBody(true)
  }

  const saveBody = async () => {
    if (saving) return
    setSaving(true)
    try {
      await updateNote({ ...note, content: draft })
      // 保存成功：清草稿（本地与 store 标志；dirty effect 随后自动复位）
      clearDraft(noteId)
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current)
        draftTimerRef.current = null
      }
      toast.success('正文已保存')
      setEditingBody(false)
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  /** 放弃当前编辑（取消按钮）：清草稿 + 退出编辑态 */
  const cancelEdit = () => {
    clearDraft(noteId)
    setPendingDirty(false)
    setEditingBody(false)
  }

  const tagChips = note.tags
    .map((id) => tags.find((t) => t._id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部工具行：返回 + 标题（三期：无对象名——已在对象内，侧边栏选中态可见归属） */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="返回" onClick={() => requestRoute(closeNote)}>
          <ArrowLeftIcon data-icon />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={note.title}>
          {note.title}
        </h2>
        {readonly && (
          <Badge variant="secondary" className="shrink-0 text-[0.7rem] font-normal">
            已归档（只读）
          </Badge>
        )}
      </div>

      {/* 编辑态：Markdown 快捷操作栏（19 项插入，仅编辑时占一行） */}
      {showEditor && <MarkdownToolbar api={editorApi ?? EMPTY_API} />}

      {/* 正文区：编辑态（CodeMirror 即时渲染）/ 只读态（MarkdownView） */}
      {showEditor ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeMirrorEditor
              ref={setEditorApi}
              value={draft}
              onChange={setDraft}
              onSave={() => void saveBody()}
              autoFocus
              placeholder={'记录要点：# 标题、**加粗**、- 列表、``` 代码块 …'}
            />
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
            <span className="mr-auto text-xs text-muted-foreground">Ctrl+S 保存正文</span>
            {editingBody && (
              <Button
                variant="outline"
                size="sm"
                onClick={cancelEdit}
                disabled={saving}
              >
                取消
              </Button>
            )}
            <Button size="sm" onClick={() => void saveBody()} disabled={saving}>
              <SaveIcon data-icon />
              保存正文
            </Button>
          </div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <article className="flex flex-col gap-3 p-4">
            {/* 元信息：标签 + 更新时间（不单独占行，随正文区展示） */}
            <div className="flex flex-wrap items-center gap-1.5">
              {tagChips.map((t) => (
                <TagChip key={t._id} tag={t} />
              ))}
              <span className="ml-auto text-[0.7rem] text-muted-foreground/80">
                更新于 {formatTime(note.updatedAt)}
              </span>
            </div>
            {note.content ? (
              <MarkdownView content={note.content} />
            ) : (
              <Empty className="gap-2">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <span className="text-lg leading-none">📄</span>
                  </EmptyMedia>
                  <EmptyTitle>暂无正文</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
            {!readonly && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={enterEdit}>
                  <PencilIcon data-icon />
                  写正文
                </Button>
              </div>
            )}
          </article>
        </ScrollArea>
      )}
    </div>
  )
}

/** 未挂载编辑器时的空实现（工具栏点击无效果，编辑器挂载后 ref 自动生效） */
const EMPTY_API: MarkdownInsertApi = {
  wrap: () => {},
  block: () => {},
  focus: () => {},
}
