/**
 * components/SettingsView.tsx —— 设置视图（二期，R6-R9）
 *
 * 交互（按钮级）：
 * - 来源类型区块：列表 = 类型名 + 「内置」Badge（内置锁定，无操作）+ 自定义行操作
 *   （重命名 Pencil / 删除 Trash）；底部常驻新增行（Input + 「添加」，Enter 提交）
 * - 新增：label 精确去重（重复/空名 → toast.error）；成功后即时生效于
 *   新建对象下拉与内容区筛选器（R8：settings store 单一数据源）
 * - 删除：AlertDialog 确认（打开时异步统计引用计数，AC5）；强制删除，
 *   被引用对象保留原类型字符串
 * - 重命名：行内 Input + 保存/取消（仅自定义；内置不可改名，R7 决策）
 * - 偏好区块：默认排序 Select（updated/created/title，relevance 仅搜索态不进偏好）
 */
import { useEffect, useState } from 'react'
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { setThemePref } from '@/lib/theme'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import type { SourceType, ThemePref } from '@/types'

function SectionLabel({ children }: { children: string }) {
  return (
    <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
  )
}

/** 自定义类型行：重命名（行内编辑）/ 删除（引用计数确认） */
function CustomTypeRow({ type }: { type: SourceType }) {
  const renameSourceType = useSettingsStore((s) => s.renameSourceType)
  const removeSourceType = useSettingsStore((s) => s.removeSourceType)
  const countReferences = useSettingsStore((s) => s.countReferences)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(type.label)
  /** 删除确认框打开时的引用计数（null = 未加载） */
  const [refCount, setRefCount] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const commitRename = async () => {
    try {
      await renameSourceType(type.id, draft)
      toast.success(`已重命名为「${draft.trim()}」`)
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // 打开删除确认框时统计引用计数（AC5；失败显示「统计失败」）
  useEffect(() => {
    if (!dialogOpen) return
    setRefCount(null)
    void countReferences(type.id)
      .then(setRefCount)
      .catch(() => setRefCount(-1))
  }, [dialogOpen, countReferences, type.id])

  const handleDelete = async () => {
    try {
      await removeSourceType(type.id)
      toast.success(`已删除类型「${type.label}」`)
    } catch (err) {
      toast.error(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex h-8 items-center gap-1.5">
      {editing ? (
        <>
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename()
              if (e.key === 'Escape') {
                setDraft(type.label)
                setEditing(false)
              }
            }}
            className="h-7 flex-1"
            aria-label="重命名类型"
          />
          <Button variant="ghost" size="icon-sm" aria-label="确认重命名" onClick={() => void commitRename()}>
            <CheckIcon data-icon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="取消重命名"
            onClick={() => {
              setDraft(type.label)
              setEditing(false)
            }}
          >
            <XIcon data-icon />
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm" title={type.label}>
            {type.label}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`重命名 ${type.label}`}
            title="重命名"
            onClick={() => setEditing(true)}
          >
            <PencilIcon data-icon />
          </Button>
          <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`删除 ${type.label}`}
                title="删除"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon data-icon />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除类型「{type.label}」？</AlertDialogTitle>
                <AlertDialogDescription>
                  {refCount === null
                    ? '统计引用中…'
                    : refCount < 0
                      ? '引用统计失败，请重试'
                      : refCount > 0
                        ? `有 ${refCount} 个对象使用该类型。删除后这些对象保留原类型标识，但筛选器与新建下拉将不再出现该类型。`
                        : '当前没有对象使用该类型。'}
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
  )
}

/** 偏好：默认排序（R9；relevance 仅搜索态，不进偏好） */
function PrefsBlock() {
  const prefs = useSettingsStore((s) => s.prefs)
  const savePrefs = useSettingsStore((s) => s.savePrefs)
  const applyPrefs = useUiStore((s) => s.applyPrefs)

  const setDefaultSort = async (v: string) => {
    const defaultSort = v as 'updated' | 'created' | 'title'
    await savePrefs({ ...prefs, defaultSort })
    applyPrefs({ defaultSort })
    toast.success('偏好已保存')
  }

  const setTheme = async (v: string) => {
    const theme = v as ThemePref
    await savePrefs({ ...prefs, theme })
    setThemePref(theme)
    toast.success('主题已保存')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm">默认排序</span>
          <span className="text-xs text-muted-foreground">
            对象详情与跨对象列表的初始排序（重启后仍生效）
          </span>
        </div>
        <Select value={prefs.defaultSort} onValueChange={(v) => void setDefaultSort(v)}>
          <SelectTrigger size="sm" aria-label="默认排序" className="w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">最近更新</SelectItem>
            <SelectItem value="created">创建时间</SelectItem>
            <SelectItem value="title">标题</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm">主题</span>
          <span className="text-xs text-muted-foreground">
            亮色 / 暗色 / 跟随系统（重启后仍生效）
          </span>
        </div>
        <Select value={prefs.theme ?? 'system'} onValueChange={(v) => void setTheme(v)}>
          <SelectTrigger size="sm" aria-label="主题" className="w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">跟随系统</SelectItem>
            <SelectItem value="light">亮色</SelectItem>
            <SelectItem value="dark">暗色</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export default function SettingsView() {
  const sourceTypes = useSettingsStore((s) => s.sourceTypes)
  const addSourceType = useSettingsStore((s) => s.addSourceType)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  const handleAdd = async () => {
    if (!newName.trim() || adding) return
    setAdding(true)
    try {
      await addSourceType(newName)
      toast.success(`已新增类型「${newName.trim()}」`)
      setNewName('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
        {/* 来源类型区块 */}
        <div className="flex flex-col gap-2">
          <SectionLabel>来源类型</SectionLabel>
          <div className="flex flex-col rounded-lg border border-border bg-card">
            {sourceTypes.map((st, i) => (
              <div key={st.id}>
                {i > 0 && <Separator />}
                <div className="flex h-8 items-center gap-1.5 px-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm" title={st.label}>
                    {st.label}
                  </span>
                  {st.builtin ? (
                    <Badge variant="secondary" className="shrink-0 text-[0.7rem] font-normal">
                      内置
                    </Badge>
                  ) : (
                    <CustomTypeRow type={st} />
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* 新增行 */}
          <div className="flex items-center gap-1.5">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd()
              }}
              placeholder="新类型名称，如：播客"
              className="h-7 flex-1"
              aria-label="新类型名称"
            />
            <Button size="sm" onClick={() => void handleAdd()} disabled={adding || !newName.trim()}>
              <PlusIcon data-icon />
              添加
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            自定义类型支持重命名与删除；内置 6 种（书籍/文章/视频/论文/GitHub/课程）锁定
          </p>
        </div>

        <Separator />

        {/* 偏好区块 */}
        <div className="flex flex-col gap-2">
          <SectionLabel>偏好</SectionLabel>
          <div className="rounded-lg border border-border bg-card p-2.5">
            <PrefsBlock />
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
