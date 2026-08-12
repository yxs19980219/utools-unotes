/**
 * components/NoteView.tsx —— 笔记详情（实时保存时代，08-12 重构）
 *
 * 交互契约（R6-R8/R10/R12-R13）：
 * - 打开非归档笔记即进入编辑态（CodeMirror + MarkdownToolbar），无「写正文」按钮
 * - 正文实时保存：停止输入 300ms 防抖自动落盘（updateNote）；成功静默、失败 toast
 * - 无手动保存按钮、无底部操作栏、无未保存确认（DirtyGuard 已整体删除）
 * - Ctrl+S 立即 flush（清防抖定时器 + 立即保存）
 * - 归档笔记只读（MarkdownView），无编辑入口
 * - 标签 + 更新时间元信息行在工具行下方共用展示（编辑/只读均可见）
 *
 * 并发正确性（design.md 3.2）：savingRef 串行化 + 成功后的追平循环——
 * 保存期间的新输入在本次保存成功后立即再保存；失败不追平（避免无限重试循环）。
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowLeftIcon } from 'lucide-react'
import { toast } from 'sonner'

import CodeMirrorEditor, { type MarkdownInsertApi } from '@/components/Editor/CodeMirrorEditor'
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

/** 实时保存防抖（ms）：打字停顿间隙不写盘，300ms 平衡实时性与写盘频率 */
const SAVE_DEBOUNCE_MS = 300

export default function NoteView({ noteId }: { noteId: string }) {
  const note = useNotesStore((s) => s.notes.find((n) => n._id === noteId))
  const object = useObjectsStore((s) =>
    note ? s.objects.find((o) => o._id === note.objectId) : undefined,
  )
  const tags = useTagsStore((s) => s.tags)
  const closeNote = useUiStore((s) => s.closeNote)
  const updateNote = useNotesStore((s) => s.update)

  /** 归档笔记只读（AC9/R13）：无编辑入口 */
  const readonly = object?.archived === true

  // ---- 正文草稿（组件本地 state；保存成功即与 store 同步，无 localStorage 草稿） ----
  const [draft, setDraft] = useState(() => note?.content ?? '')
  /** ref 镜像：保存回调经防抖定时器触发时读取最新输入（避免闭包 stale） */
  const draftRef = useRef(draft)
  /** 防抖定时器（ref 存 timer，禁止进 state：会触发重渲染，hook-guidelines） */
  const saveTimerRef = useRef<number | null>(null)
  /** 保存进行中标志（并发串行化） */
  const savingRef = useRef(false)

  /** 编辑器可见：非归档恒编辑（空正文亦直接编辑，placeholder 引导） */
  const showEditor = !readonly

  /** noteId 变化（组件重挂外的兜底）：重置草稿与防抖 */
  useEffect(() => {
    const current = useNotesStore.getState().getById(noteId)?.content ?? ''
    draftRef.current = current
    setDraft(current)
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [noteId])

  /** 实时保存（防抖到点 / Ctrl+S / 卸载 flush 共用） */
  async function save() {
    saveTimerRef.current = null
    if (savingRef.current) return // 保存中：本次跳过，由完成后的追平检查兜住
    const latest = useNotesStore.getState().getById(noteId)
    const content = draftRef.current
    if (!latest || content === latest.content) return // 无改动不写盘
    savingRef.current = true
    let ok = false
    try {
      await updateNote({ ...latest, content })
      ok = true
    } catch (err) {
      // 失败不追平（避免失败无限重试）；内容保留在 draft，下次输入/Ctrl+S 重试
      toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      savingRef.current = false
    }
    // 成功且保存期间又有新输入 → 立即追平（循环直至无新输入）
    if (ok && draftRef.current !== content) void save()
  }

  /** 输入：更新草稿 + 重置防抖定时器 */
  const handleChange = (value: string) => {
    draftRef.current = value
    setDraft(value)
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void save(), SAVE_DEBOUNCE_MS)
  }

  /** 卸载：清防抖；若有未落盘改动立即 flush（fire-and-forget，路由切换无确认） */
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        const latest = useNotesStore.getState().getById(noteId)
        const content = draftRef.current
        if (latest && content !== latest.content && !savingRef.current) {
          void useNotesStore.getState().update({ ...latest, content })
        }
      }
    }
  }, [noteId])

  // 编辑器插入 API（state 驱动：ref 变化不触发渲染，工具栏需要实时拿到实例）
  const [editorApi, setEditorApi] = useState<MarkdownInsertApi | null>(null)

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

  const tagChips = note.tags
    .map((id) => tags.find((t) => t._id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部工具行：返回 + 标题（去分割线，靠留白分区） */}
      <div className="flex shrink-0 items-center gap-2 px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="返回" onClick={closeNote}>
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

      {/* 元信息行：标签 + 更新时间（编辑/只读共用，无分割线） */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-1.5">
        {tagChips.map((t) => (
          <TagChip key={t._id} tag={t} />
        ))}
        <span className="ml-auto text-[0.7rem] text-muted-foreground/80">
          更新于 {formatTime(note.updatedAt)}
        </span>
      </div>

      {showEditor ? (
        <>
          {/* Markdown 快捷操作栏（仅编辑时占一行） */}
          <MarkdownToolbar api={editorApi ?? EMPTY_API} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeMirrorEditor
              ref={setEditorApi}
              value={draft}
              onChange={handleChange}
              onSave={() => {
                // Ctrl+S：清防抖定时器 + 立即保存
                if (saveTimerRef.current !== null) {
                  window.clearTimeout(saveTimerRef.current)
                  saveTimerRef.current = null
                }
                void save()
              }}
              autoFocus
              placeholder={'记录要点：# 标题、**加粗**、- 列表、``` 代码块 …'}
            />
          </div>
        </>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <article className="flex flex-col gap-3 p-4">
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
