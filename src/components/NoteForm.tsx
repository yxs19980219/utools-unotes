/**
 * components/NoteForm.tsx —— 新建/编辑笔记表单（design.md 交互细节 5：全内容区替换）
 *
 * 字段：归属对象 Select（可切换，编辑态含被归档对象兜底）+「新建对象」快捷入口、
 * 标题（必填）、正文 CodeMirror 6 即时渲染编辑器（阶段 5a，编辑/预览切换，
 * 预览复用 MarkdownView）、标签 TagInput 联想补全（阶段 5c，AC4）。
 * AC10：未选归属对象时保存按钮禁用 + 强提示（数据层 create 亦有兜底校验）。
 * Ctrl+S：编辑器内由 CodeMirror keymap 处理；标题等输入框由 window 监听兜底，
 * 两者互斥避免重复保存（.cm-editor 内事件窗口监听跳过）。
 * 保存成功：新建 → selectObject(objectId) 回对象详情；编辑 → 同上。
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import CodeMirrorEditor from '@/components/Editor/CodeMirrorEditor'
import MarkdownView from '@/components/MarkdownView'
import TagInput from '@/components/TagInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
  const startEditing = useUiStore((s) => s.startEditing)

  // 新建时预填当前对象详情上下文（对象详情内 [＋新笔记] / header 新建）
  const [objectId, setObjectId] = useState(
    note?.objectId ?? (editingId === null ? selectedObjectId ?? '' : ''),
  )
  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  /** 已选标签（canonical tagId 列表，TagInput 维护） */
  const [tags, setTags] = useState<string[]>(note?.tags ?? [])
  /** 编辑/预览模式（预览复用 MarkdownView 只读渲染） */
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [saving, setSaving] = useState(false)

  // TODO（MVP 允许直接丢弃）：编辑中切走（视图切换）时 store 已取消编辑，表单卸载
  // 即丢失未保存内容；如需草稿保留，可在卸载前比对初始值并提示/暂存（二期再做）

  // 对象下拉选项：未归档对象；编辑时若归属对象已归档则并入（只读语境兜底）
  const options = useMemo(() => {
    const active = allObjects.filter((o) => !o.archived)
    if (note) {
      const owner = allObjects.find((o) => o._id === note.objectId)
      if (owner && owner.archived && !active.some((o) => o._id === owner._id)) {
        return [...active, owner]
      }
    }
    return active
  }, [allObjects, note])

  const isNew = !note
  /** AC10：未选归属对象（或对象已删除）→ 禁止保存 */
  const noObject = objectId === '' || !allObjects.some((o) => o._id === objectId)
  const canSave = !noObject && title.trim().length > 0 && !saving

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
      if (note) {
        await updateNote({
          ...note,
          objectId,
          title: title.trim(),
          content,
          tags: tagIds,
        })
        toast.success('笔记已更新')
      } else {
        await createNote({ objectId, title: title.trim(), content, tags: tagIds })
        toast.success('笔记已保存')
      }
      selectObject(objectId)
      stopEditing()
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  // Ctrl+S：编辑器内由 CodeMirror keymap 处理并阻断默认；此处兜底标题等输入框。
  // 无依赖数组 → 每次渲染重挂，回调永远是最新的 canSave/handleSave（成本可忽略）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      if (e.target instanceof HTMLElement && e.target.closest('.cm-editor')) return
      e.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-3 p-4">
          {/* 归属对象（AC10 强约束） */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="note-object">归属对象</FieldLabel>
            <div className="flex items-center gap-1.5">
              <Select value={objectId} onValueChange={setObjectId}>
                <SelectTrigger id="note-object" aria-label="归属对象" className="w-full">
                  <SelectValue placeholder="选择归属对象" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o._id} value={o._id}>
                      {o.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isNew && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => startEditing('object', null)}
                  title="先创建对象，再回来写笔记"
                >
                  ＋新建对象
                </Button>
              )}
            </div>
            {noObject && (
              <p className="text-xs text-destructive">
                必须选择归属对象才能保存（新建对象后再创建笔记）
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="note-title">标题</FieldLabel>
            <Input
              id="note-title"
              autoFocus={!noObject}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="笔记要点标题"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) void handleSave()
              }}
            />
          </div>

          {/* 正文：CodeMirror 即时渲染编辑器（阶段 5a）/ 预览切换（复用 MarkdownView） */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <FieldLabel>正文（Markdown）</FieldLabel>
              <ToggleGroup
                type="single"
                size="sm"
                value={mode}
                onValueChange={(v) => v && setMode(v as 'edit' | 'preview')}
                className="h-6"
              >
                <ToggleGroupItem value="edit" className="h-6 px-2 text-xs">
                  编辑
                </ToggleGroupItem>
                <ToggleGroupItem value="preview" className="h-6 px-2 text-xs">
                  预览
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="min-h-56 min-w-0 flex-1 overflow-hidden rounded-md border border-border">
              {mode === 'edit' ? (
                <CodeMirrorEditor
                  value={content}
                  onChange={setContent}
                  onSave={handleSave}
                  placeholder={'支持 Markdown：# 标题、**加粗**、- 列表、``` 代码块 …'}
                />
              ) : (
                <ScrollArea className="h-full">
                  <MarkdownView content={content} className="p-3" />
                </ScrollArea>
              )}
            </div>
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
        <span className="mr-auto text-xs text-muted-foreground">Ctrl+S 保存</span>
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
