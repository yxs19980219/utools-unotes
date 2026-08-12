/**
 * components/NoteForm.tsx —— 新建/编辑笔记表单（快速创建：标题 + 标签）
 *
 * 产品语义（用户确认）：
 * - 归属对象不在此选择：对象详情内创建默认归属当前对象（上下文预填）；
 *   仅当无上下文（如 header 直接新建且未选中对象）时显示兜底对象选择（AC10）
 * - 不提供正文编辑器：创建即列表卡片，点击卡片进入笔记详情再写正文（NoteView 内联编辑器）
 * - 标题可留空：保存时自动占位「未命名 MM-DD HH:mm」，用户随时可改（解决"一个对象
 *   只有一条笔记时标题难起"）
 * 标签：TagInput 联想补全（匹配 name+aliases），提交经 resolveTagIds 统一归并（唯一入口）。
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import TagInput from '@/components/TagInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useNotesStore } from '@/stores/notes'
import { useObjectsStore } from '@/stores/objects'
import { useTagsStore } from '@/stores/tags'
import { useUiStore } from '@/stores/ui'

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
      {children}
    </label>
  )
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 空标题占位：未命名 + 创建时刻（可辨识、可区分多条） */
function defaultTitle(): string {
  const d = new Date()
  return `未命名 ${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export default function NoteForm() {
  const editingId = useUiStore((s) => s.editing?.id ?? null)
  const note = useNotesStore((s) =>
    editingId ? s.notes.find((n) => n._id === editingId) : undefined,
  )
  const allObjects = useObjectsStore((s) => s.objects)
  const selectedObjectId = useUiStore((s) => s.selectedObjectId)
  const createNote = useNotesStore((s) => s.create)
  const updateNote = useNotesStore((s) => s.update)
  const selectObject = useUiStore((s) => s.selectObject)
  const stopEditing = useUiStore((s) => s.stopEditing)

  // 新建：预填当前对象详情上下文；编辑：取笔记归属对象
  const [objectId, setObjectId] = useState(
    note?.objectId ?? (editingId === null ? selectedObjectId ?? '' : ''),
  )
  const [title, setTitle] = useState(note?.title ?? '')
  /** 已选标签（canonical tagId 列表，TagInput 维护） */
  const [tags, setTags] = useState<string[]>(note?.tags ?? [])
  const [saving, setSaving] = useState(false)

  const isNew = !note
  /** 仅无上下文的新建（header 直接新建且未选中对象）才显示兜底对象选择 */
  const needObjectPick = isNew && objectId === ''
  const activeObjects = useMemo(() => allObjects.filter((o) => !o.archived), [allObjects])
  /** AC10：归属对象缺失（或已删除）→ 禁止保存 */
  const noObject = objectId === '' || !allObjects.some((o) => o._id === objectId)
  const canSave = !noObject && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      // 提交语义：标签统一经 resolveTagIds 归并（唯一入口；TagInput 已保证 canonical）
      const tagIds = await useTagsStore.getState().resolveTagIds(
        tags
          .map((id) => useTagsStore.getState().getById(id)?.name)
          .filter((n): n is string => !!n),
      )
      // 标题可空：自动占位（进入笔记后可随时修改）
      const finalTitle = title.trim() || defaultTitle()
      if (note) {
        await updateNote({ ...note, objectId, title: finalTitle, tags: tagIds })
        toast.success('笔记已更新')
      } else {
        await createNote({ objectId, title: finalTitle, content: '', tags: tagIds })
        toast.success('笔记已创建')
      }
      selectObject(objectId)
      stopEditing()
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-3 p-4">
          {/* 兜底对象选择（仅无上下文新建时出现，正常路径隐藏） */}
          {needObjectPick && (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="note-object">归属对象</FieldLabel>
              <Select value={objectId} onValueChange={setObjectId}>
                <SelectTrigger id="note-object" aria-label="归属对象" className="w-full">
                  <SelectValue placeholder="选择归属对象" />
                </SelectTrigger>
                <SelectContent>
                  {activeObjects.map((o) => (
                    <SelectItem key={o._id} value={o._id}>
                      {o.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {noObject && (
                <p className="text-xs text-destructive">
                  必须选择归属对象才能保存（新建对象后再创建笔记）
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="note-title">标题（可留空）</FieldLabel>
            <Input
              id="note-title"
              autoFocus={!needObjectPick}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="要点标题，留空将自动生成「未命名」"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) void handleSave()
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="note-tags">标签</FieldLabel>
            <TagInput
              id="note-tags"
              value={tags}
              onChange={setTags}
              placeholder="输入标签名，如：深度学习（联想命中别名 deep learning / DL）"
            />
            <p className="text-xs text-muted-foreground">
              联想补全匹配标签名与别名；回车直接创建新标签
            </p>
          </div>
        </div>
      </div>

      {/* 底部操作 */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
        <span className="mr-auto text-xs text-muted-foreground">
          保存后点击笔记卡片，进入详情写正文
        </span>
        <Button variant="outline" size="sm" onClick={stopEditing} disabled={saving}>
          取消
        </Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave}>
          {isNew ? '保存' : '更新'}
        </Button>
      </div>
    </div>
  )
}
