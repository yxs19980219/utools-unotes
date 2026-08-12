/**
 * components/ContentHeader.tsx —— 内容区唯一顶栏（三期：语境化渲染矩阵）
 *
 * 三期重构：ObjectDetail 元数据条/列表标题行删除，顶栏信息与操作全部收敛于此。
 * 语境矩阵（design.md 第 2 节）：
 * - editing         → 表单标题（无操作）
 * - searchActive    → 「搜索结果」+ [排序▾][来源筛选▾]
 * - selectedObject  → 来源 Badge + 标题 + 笔记数 +（归档）已归档 Badge + 第二行元数据
 *                      + [排序▾][＋新笔记][归档][编辑][删除] / 只读态 [排序▾][恢复]
 * - selectedTag     → 标签名 + [排序▾][来源筛选▾]
 * - 视图空态         → 视图名（无操作；settings 亦无操作）
 * 删除：顶部「新建▾」下拉（入口收敛：新建对象=侧边栏「活跃对象」+，新建笔记=详情顶栏＋）
 *      搜索按钮（uTools 子输入框注册保留，原生搜索条直接可用）
 */
import { useMemo, useState } from 'react'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowUpDownIcon,
  CalendarIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UserIcon,
} from 'lucide-react'

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
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  archiveObject,
  removeObjectWithToast,
  restoreObject,
} from '@/lib/objectActions'
import { sourceTypeLabel, useSourceTypes } from '@/lib/sourceTypes'
import { selectNotesByObject, useNotesStore } from '@/stores/notes'
import { useObjectsStore } from '@/stores/objects'
import { useTagsStore } from '@/stores/tags'
import { useUiStore } from '@/stores/ui'
import { useShallow } from 'zustand/react/shallow'

/** 标题推导：编辑态 > 搜索态 > 选中对象/标签 > 视图名 */
function useHeaderTitle(): string {
  const view = useUiStore((s) => s.view)
  const editing = useUiStore((s) => s.editing)
  const searchActive = useUiStore((s) => s.search.active)
  const selectedObjectId = useUiStore((s) => s.selectedObjectId)
  const selectedTagId = useUiStore((s) => s.selectedTagId)
  const object = useObjectsStore((s) =>
    selectedObjectId ? s.objects.find((o) => o._id === selectedObjectId) : undefined,
  )
  const tag = useTagsStore((s) =>
    selectedTagId ? s.tags.find((t) => t._id === selectedTagId) : undefined,
  )

  return useMemo(() => {
    if (editing) {
      return editing.kind === 'note'
        ? editing.id
          ? '编辑笔记'
          : '新建笔记'
        : editing.id
          ? '编辑对象'
          : '新建对象'
    }
    if (searchActive) return '搜索结果'
    if (selectedObjectId) return object?.title ?? ''
    if (selectedTagId) return tag?.name ?? ''
    if (view === 'home') return '首页'
    if (view === 'tags') return '标签'
    if (view === 'archived') return '归档'
    return '设置'
  }, [editing, searchActive, selectedObjectId, selectedTagId, view, object?.title, tag?.name])
}

/** 对象详情顶栏（三期：唯一顶栏——Badge+标题+笔记数+排序+操作；第二行元数据） */
function ObjectHeaderActions({ objectId }: { objectId: string }) {
  const object = useObjectsStore((s) => s.objects.find((o) => o._id === objectId))
  const notes = useNotesStore(useShallow((s) => selectNotesByObject(s, objectId)))
  const sourceTypes = useSourceTypes()
    const startEditing = useUiStore((s) => s.startEditing)
  const sort = useUiStore((s) => s.sort)
  const setSort = useUiStore((s) => s.setSort)
  /** 确认框类型（恢复/删除；归档走独立 AlertDialogTrigger），null = 关闭 */
  const [dialog, setDialog] = useState<'archive' | 'restore' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)

  if (!object) return null
  const readonly = object.archived
  const meta = object.sourceMeta

  const handleArchive = async () => {
    setBusy(true)
    const ok = await archiveObject(objectId)
    if (ok) setDialog(null)
    setBusy(false)
  }
  const handleRestore = async () => {
    setBusy(true)
    const ok = await restoreObject(objectId)
    if (ok) setDialog(null)
    setBusy(false)
  }
  const handleDelete = async () => {
    setBusy(true)
    const count = await removeObjectWithToast(objectId)
    if (count >= 0) setDialog(null)
    setBusy(false)
  }

  const dialogContent =
    dialog === 'archive'
      ? {
          title: `将归档「${object.title}」？`,
          desc: `其下 ${notes.length} 条笔记将一并转为只读。归档后可在侧边栏「归档」视图恢复。`,
          action: '归档',
        }
      : dialog === 'restore'
        ? {
            title: `恢复对象「${object.title}」？`,
            desc: `将移回活跃列表，其下 ${notes.length} 条笔记恢复可编辑。`,
            action: '恢复',
          }
        : dialog === 'delete'
          ? {
              title: `删除对象「${object.title}」？`,
              desc: `将删除该对象及其下 ${notes.length} 条笔记，该操作不可恢复。`,
              action: '删除',
            }
          : null

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Badge variant="secondary" className="shrink-0">
          {sourceTypeLabel(object.sourceType, sourceTypes)}
        </Badge>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={object.title}>
          {object.title}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">笔记 · {notes.length}</span>
        {readonly && (
          <Badge
            variant="outline"
            className="shrink-0 text-[0.7rem] font-normal text-muted-foreground"
          >
            已归档（只读）
          </Badge>
        )}
        {/* 排序菜单（对象详情列表排序，R17） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="排序">
              <ArrowUpDownIcon data-icon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <DropdownMenuRadioItem value="updated">最近更新</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="created">创建时间</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="title">标题</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {readonly ? (
          <Button size="sm" onClick={() => setDialog('restore')}>
            <ArchiveRestoreIcon data-icon />
            恢复
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => startEditing('note', null)}>
              <PlusIcon data-icon />
              新笔记
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="归档对象"
              title="归档"
              onClick={() => setDialog('archive')}
            >
              <ArchiveIcon data-icon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="编辑对象"
              title="编辑"
              onClick={() => startEditing('object', objectId)}
            >
              <PencilIcon data-icon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="删除对象"
              title="删除"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setDialog('delete')}
            >
              <Trash2Icon data-icon />
            </Button>
          </>
        )}
      </div>

      {/* 来源元数据信息块（方案 B：浅灰圆角块与标题一体，无分割线；有内容才显示） */}
      {(meta?.author || meta?.url || meta?.year) && (
        <div className="mx-3 mb-1.5 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md bg-muted/50 px-2.5 py-1.5">
          {meta?.author && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <UserIcon data-icon className="size-3 shrink-0" />
              <span className="truncate">{meta.author}</span>
            </span>
          )}
          {meta?.year && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarIcon data-icon className="size-3 shrink-0" />
              {meta.year}
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
        </div>
      )}

      {/* 统一确认框（恢复/删除；归档走独立 AlertDialogTrigger 保持 trigger 语义） */}
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
    </>
  )
}

export default function ContentHeader() {
  const title = useHeaderTitle()
  const editing = useUiStore((s) => s.editing)
  const searchActive = useUiStore((s) => s.search.active)
  const activeNoteId = useUiStore((s) => s.activeNoteId)
  const selectedObjectId = useUiStore((s) => s.selectedObjectId)
  const selectedTagId = useUiStore((s) => s.selectedTagId)
  const sort = useUiStore((s) => s.sort)
  const sourceFilter = useUiStore((s) => s.sourceFilter)
  const setSort = useUiStore((s) => s.setSort)
  const setSourceFilter = useUiStore((s) => s.setSourceFilter)
  const sourceTypes = useSourceTypes()

  // 笔记详情沉浸模式（三期用户反馈）：打开笔记后顶部对象/搜索/标签栏全部隐藏，
  // NoteView 自己的顶栏（返回+标题+标签+时间）成为唯一顶栏；返回后恢复原栏
  if (activeNoteId) return null

  // 来源筛选：标签跨对象列表语境与搜索态均显示（搜索态与 type: 语法叠加，R17）
  const showSourceFilter = selectedTagId !== null || searchActive
  // 对象详情语境：操作区由 ObjectHeaderActions 承载；搜索态优先（与 ContentArea 路由一致：
  // activeNoteId > searchActive > selectedObjectId——搜索态下顶栏显示「搜索结果」+排序/筛选）
  const showObjectActions = selectedObjectId !== null && !searchActive
  // 排序菜单仅 搜索态/标签语境 显示（对象详情排序在 ObjectHeaderActions 操作区内）
  const showSortMenu = searchActive || selectedTagId !== null

  // 编辑态：全内容区被表单替换，标题行右侧操作全部隐藏（design 交互细节 5）
  if (editing) {
    return (
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </h1>
      </header>
    )
  }

  // 对象详情：唯一顶栏（ObjectHeaderActions 内含排序/操作/元数据，标题不重复）
  if (showObjectActions) {
    return <ObjectHeaderActions objectId={selectedObjectId} />
  }

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
        {title}
      </h1>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* 排序菜单（R17；搜索态/标签语境） */}
        {showSortMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="排序">
                <ArrowUpDownIcon data-icon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                <DropdownMenuRadioItem value="updated">最近更新</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="created">创建时间</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="title">标题</DropdownMenuRadioItem>
                {searchActive && (
                  <DropdownMenuRadioItem value="relevance">相关度</DropdownMenuRadioItem>
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 来源类型筛选（R17：标签跨对象列表语境与搜索态显示） */}
        {showSourceFilter && (
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger size="sm" aria-label="来源类型筛选" className="max-w-32">
              <SelectValue placeholder="全部来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              {sourceTypes.map((st) => (
                <SelectItem key={st.id} value={st.id}>
                  {st.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </header>
  )
}
