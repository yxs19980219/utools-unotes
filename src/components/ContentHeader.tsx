/**
 * components/ContentHeader.tsx —— 内容区唯一顶栏（三期：语境化渲染矩阵）
 *
 * 三期重构：ObjectDetail 元数据条/列表标题行删除，顶栏信息与操作全部收敛于此。
 * 08-12 简化：对象级操作（归档/编辑/删除/恢复）全部收敛到侧边栏对象行右键菜单；
 * 顶栏仅保留高频操作：排序、ℹ 元数据查看（Popover）、新笔记（最右）。
 * 语境矩阵（design.md 第 2 节）：
 * - editing         → 表单标题（无操作）
 * - searchActive    → 「搜索结果」+ [排序▾][来源筛选▾]
 * - selectedObject  → 来源 Badge + 标题 + 笔记数 +（归档）已归档 Badge
 *                      + [排序▾][ℹ][＋新笔记] / 只读态 [排序▾][ℹ]
 * - selectedTag     → 标签名 + [排序▾][来源筛选▾]
 * - 视图空态         → 视图名（无操作；settings 亦无操作）
 * 删除：顶部「新建▾」下拉（入口收敛：新建对象=侧边栏「活跃对象」+，新建笔记=详情顶栏＋）
 *      搜索按钮（uTools 子输入框注册保留，原生搜索条直接可用）
 */
import { useMemo } from 'react'
import {
  ArrowUpDownIcon,
  CalendarIcon,
  InfoIcon,
  LinkIcon,
  PlusIcon,
  UserIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { sourceTypeLabel, useSourceTypes } from '@/lib/sourceTypes'
import { filterNotesBySource, selectNotesByObject, selectNotesByTag, useNotesStore } from '@/stores/notes'
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

/** 对象详情顶栏（08-12：高频操作收敛——排序 + ℹ 元数据 + 新笔记最右；归档/编辑/删除/恢复在侧边栏右键） */
function ObjectHeaderActions({ objectId }: { objectId: string }) {
  const object = useObjectsStore((s) => s.objects.find((o) => o._id === objectId))
  const notes = useNotesStore(useShallow((s) => selectNotesByObject(s, objectId)))
  const sourceTypes = useSourceTypes()
  const startEditing = useUiStore((s) => s.startEditing)
  const sort = useUiStore((s) => s.sort)
  const setSort = useUiStore((s) => s.setSort)

  if (!object) return null
  const readonly = object.archived
  const meta = object.sourceMeta
  /** ℹ 元数据查看：无任何元数据时不显示按钮 */
  const hasMeta = !!(meta?.author || meta?.url || meta?.year)

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Badge variant="secondary" className="shrink-0">
          {sourceTypeLabel(object.sourceType, sourceTypes)}
        </Badge>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold" title={object.title}>
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
        {/* ℹ 元数据查看（Popover，无元数据隐藏） */}
        {hasMeta && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="查看元数据"
                title="查看元数据"
                className="rounded-full"
              >
                <InfoIcon data-icon />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <div className="flex flex-col gap-1.5">
                {meta?.author && (
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <UserIcon data-icon className="size-3.5 shrink-0" />
                    <span className="truncate">{meta.author}</span>
                  </span>
                )}
                {meta?.year && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarIcon data-icon className="size-3.5 shrink-0" />
                    {meta.year}
                  </span>
                )}
                {meta?.url && (
                  <a
                    href={meta.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    title={meta.url}
                  >
                    <LinkIcon data-icon className="size-3.5 shrink-0" />
                    <span className="truncate">{meta.url.replace(/^https?:\/\//, '')}</span>
                  </a>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {/* 新笔记（最右侧；归档对象只读不显示） */}
        {!readonly && (
          <Button size="sm" onClick={() => startEditing('note', null)}>
            <PlusIcon data-icon />
            新笔记
          </Button>
        )}
      </div>
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

  // 标签语境笔记计数（与 TagNotesList 同源：来源筛选后数量，随筛选联动）
  const tagNotes = useNotesStore(useShallow((s) => (selectedTagId ? selectNotesByTag(s, selectedTagId) : [])))
  const allObjects = useObjectsStore((s) => s.objects)
  const tagNoteCount = useMemo(() => {
    if (!selectedTagId) return 0
    const objectById = new Map(allObjects.map((o) => [o._id, o]))
    return filterNotesBySource(tagNotes, objectById, sourceFilter).length
  }, [selectedTagId, tagNotes, allObjects, sourceFilter])

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
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold" title={title}>
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
    <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold" title={title}>
        {title}
      </h1>

      {/* 标签语境笔记计数（与对象详情顶栏「笔记 · N」同理；搜索态不显示） */}
      {selectedTagId !== null && !searchActive && (
        <span className="shrink-0 text-xs text-muted-foreground">笔记 · {tagNoteCount}</span>
      )}

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
