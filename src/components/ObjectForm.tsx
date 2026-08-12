/**
 * components/ObjectForm.tsx —— 新建/编辑对象表单（design.md 交互细节 5：全内容区替换）
 *
 * 字段：标题（必填）、来源类型 Select（内置 + 自定义，三期随设置页扩展）、
 * sourceMeta（author/url/year，均可选）。
 * 三期：删除标签输入（对象标签是“死数据”，标签语义只属于笔记——prd R10）。
 * 保存成功：新建 → selectObject(obj._id) 直达详情；编辑 → 留在详情；均 stopEditing。
 */
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSourceTypes } from '@/lib/sourceTypes'
import { useObjectsStore } from '@/stores/objects'
import { useUiStore } from '@/stores/ui'
import type { SourceMeta } from '@/types'

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
      {children}
    </label>
  )
}

export default function ObjectForm() {
  const editingId = useUiStore((s) => s.editing?.id ?? null)
  const existing = useObjectsStore((s) =>
    editingId ? s.objects.find((o) => o._id === editingId) : undefined,
  )
  const sourceTypes = useSourceTypes()
  const createObject = useObjectsStore((s) => s.create)
  const updateObject = useObjectsStore((s) => s.update)
  const selectObject = useUiStore((s) => s.selectObject)
  const stopEditing = useUiStore((s) => s.stopEditing)

  const [title, setTitle] = useState(existing?.title ?? '')
  const [sourceType, setSourceType] = useState(existing?.sourceType ?? 'book')
  const [author, setAuthor] = useState(existing?.sourceMeta.author ?? '')
  const [url, setUrl] = useState(existing?.sourceMeta.url ?? '')
  const [year, setYear] = useState(existing?.sourceMeta.year ?? '')
  const [saving, setSaving] = useState(false)

  const canSave = title.trim().length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const sourceMeta: SourceMeta = {
        author: author.trim() || undefined,
        url: url.trim() || undefined,
        year: year.trim() || undefined,
      }
      if (existing) {
        await updateObject({
          ...existing,
          title: title.trim(),
          sourceType,
          sourceMeta,
        })
        toast.success('对象已更新')
      } else {
        const obj = await createObject({
          title: title.trim(),
          sourceType,
          sourceMeta,
        })
        toast.success(`已创建「${obj.title}」`)
        selectObject(obj._id)
      }
      stopEditing()
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="obj-title">标题</FieldLabel>
            <Input
              id="obj-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={sourceTypes.find((s) => s.id === sourceType)?.label ?? '书名 / 课程名 / 项目名'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) void handleSave()
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>来源类型</FieldLabel>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger aria-label="来源类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceTypes.map((st) => (
                  <SelectItem key={st.id} value={st.id}>
                    {st.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>来源元数据（可选）</FieldLabel>
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="作者 / 演讲者 / 维护者"
            />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="链接（DOI / 仓库 / 视频地址）"
            />
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="年份"
            />
          </div>
        </div>
      </ScrollArea>

      {/* 底部操作 */}
      <div className="flex shrink-0 items-center justify-end gap-2 bg-muted/50 px-3 py-2">
        <Button variant="outline" size="sm" onClick={stopEditing} disabled={saving}>
          取消
        </Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave}>
          {existing ? '保存' : '创建'}
        </Button>
      </div>
    </div>
  )
}
