/**
 * components/ContentHeader.tsx —— 内容区标题行（阶段 4：交互接线）
 *
 * 左侧：标题（按视图/选中项/搜索态/编辑态推导）；
 * 右侧（编辑态隐藏）：排序菜单（ui.sort）+ 来源筛选（ui.sourceFilter，仅标签跨对象
 * 语境显示）+ [＋新建] 下拉（按当前上下文智能默认：对象详情内新建笔记自动带 objectId，
 * 由 NoteForm 读取 selectedObjectId 预填）+ 搜索放大镜（阶段 7 接 subInputFocus）。
 */
import { useMemo } from 'react'
import {
  ArrowUpDownIcon,
  FileTextIcon,
  FolderPlusIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSourceTypes } from '@/lib/sourceTypes'
import { useObjectsStore } from '@/stores/objects'
import { useTagsStore } from '@/stores/tags'
import { useUiStore } from '@/stores/ui'

/** 标题推导：编辑态 > 搜索态 > 视图/选中项 */
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
    if (view === 'home') return object?.title ?? tag?.name ?? '首页'
    if (view === 'tags') return tag?.name ?? '标签'
    if (view === 'archived') return '归档'
    return '设置'
  }, [editing, searchActive, view, object?.title, tag?.name])
}

export default function ContentHeader() {
  const title = useHeaderTitle()
  const editing = useUiStore((s) => s.editing)
  const searchActive = useUiStore((s) => s.search.active)
  const selectedTagId = useUiStore((s) => s.selectedTagId)
  const sort = useUiStore((s) => s.sort)
  const sourceFilter = useUiStore((s) => s.sourceFilter)
  const setSort = useUiStore((s) => s.setSort)
  const setSourceFilter = useUiStore((s) => s.setSourceFilter)
  const startEditing = useUiStore((s) => s.startEditing)
  const requestRoute = useUiStore((s) => s.requestRoute)
  const sourceTypes = useSourceTypes()

  // 来源筛选：标签跨对象列表语境与搜索态均显示（搜索态与 type: 语法叠加，R17）
  const showSourceFilter = selectedTagId !== null || searchActive

  const view = useUiStore((s) => s.view)

  // 编辑态：全内容区被表单替换，标题行右侧操作全部隐藏（design 交互细节 5）
  if (editing) {
    return (
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </h1>
      </header>
    )
  }

  // 设置视图：无列表语境，右侧操作（排序/筛选/新建/搜索）隐藏
  if (view === 'settings') {
    return (
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </h1>
      </header>
    )
  }

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
        {title}
      </h1>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* 排序菜单（R17；relevance 仅搜索态启用） */}
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

        {/* 来源类型筛选（R17：仅标签跨对象列表语境显示；对象详情隐藏） */}
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

        {/* 新建下拉：对象详情内新建笔记由 NoteForm 预填当前对象（4e 智能默认） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <PlusIcon data-icon />
              新建
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => requestRoute(() => startEditing('note', null))}>
              <FileTextIcon data-icon />
              新建笔记
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => requestRoute(() => startEditing('object', null))}>
              <FolderPlusIcon data-icon />
              新建对象
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 搜索放大镜：聚焦 uTools 子输入框（阶段 7；setSubInput 已在 App.tsx 注册，R16） */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="全文搜索"
              onClick={() => {
                if (
                  typeof utools !== 'undefined' &&
                  typeof utools.subInputFocus === 'function'
                ) {
                  utools.subInputFocus()
                }
                // TODO(浏览器调试)：无 utools 环境（vite dev 浏览器）时此处 no-op；
                // 如需在浏览器验证搜索态，可临时改为 setSearch(true, '关键词')
              }}
            >
              <SearchIcon data-icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">全文搜索</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
