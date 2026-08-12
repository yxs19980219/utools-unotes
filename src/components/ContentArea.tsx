/**
 * components/ContentArea.tsx —— 内容区路由（design.md 第 6 节）
 *
 * 优先级：编辑态（全内容区表单）> 笔记全文 > 搜索态（阶段 7）> 对象详情 >
 * 标签跨对象列表 > 各视图空态。
 * 搜索态点卡片进全文（AC9 只读），返回后仍回到搜索结果（search.active 保留）。
 * 归档/设置为二期：视图置灰，此处兜底空态。
 */
import { useMemo } from 'react'
import { BookOpenIcon, SearchIcon, TagIcon } from 'lucide-react'

import NoteCardList from '@/components/NoteCardList'
import NoteForm from '@/components/NoteForm'
import NoteView from '@/components/NoteView'
import ObjectDetail from '@/components/ObjectDetail'
import ObjectForm from '@/components/ObjectForm'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { searchNotes, sortNotes, type SearchContext, type SearchResult } from '@/services/search'
import { selectNotesByTag, useNotesStore } from '@/stores/notes'
import { useObjectsStore } from '@/stores/objects'
import { useTagsStore } from '@/stores/tags'
import { useShallow } from 'zustand/react/shallow'

import { useUiStore } from '@/stores/ui'

/** 标签跨对象笔记列表（来源筛选由 ContentHeader 写入 ui.sourceFilter，此处过滤） */
function TagNotesList({ tagId }: { tagId: string }) {
  const notes = useNotesStore(useShallow((s) => selectNotesByTag(s, tagId)))
  const objects = useObjectsStore((s) => s.objects)
  const sourceFilter = useUiStore((s) => s.sourceFilter)

  const objectById = useMemo(() => new Map(objects.map((o) => [o._id, o])), [objects])
  const filtered = useMemo(() => {
    if (sourceFilter === 'all') return notes
    return notes.filter((n) => objectById.get(n.objectId)?.sourceType === sourceFilter)
  }, [notes, sourceFilter, objectById])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          跨对象笔记 · {filtered.length}
        </span>
      </div>
      <NoteCardList notes={filtered} crossObject />
    </div>
  )
}

/** 搜索结果（阶段 7：子输入框全文搜索，R16/AC6；来源筛选叠加 AND；AC9 归档命中只读角标） */
function SearchResults() {
  const query = useUiStore((s) => s.search.query)
  const sort = useUiStore((s) => s.sort)
  const sourceFilter = useUiStore((s) => s.sourceFilter)
  const notes = useNotesStore((s) => s.notes)
  const objects = useObjectsStore((s) => s.objects)
  const tags = useTagsStore((s) => s.tags)

  const results = useMemo<SearchResult[]>(() => {
    const ctx: SearchContext = { notes, objects, tags }
    const found = searchNotes(query, ctx)
    // 来源筛选与 type: 语法叠加（AND 语义，R17）
    const filtered =
      sourceFilter === 'all'
        ? found
        : found.filter((r) => r.object?.sourceType === sourceFilter)
    // 排序：relevance = 服务层相关度序（搜索态默认）；其余由 sortNotes 重排
    if (sort === 'relevance') return filtered
    const byId = new Map(filtered.map((r) => [r.note._id, r]))
    return sortNotes(
      filtered.map((r) => r.note),
      sort,
    )
      .map((n) => byId.get(n._id))
      .filter((r): r is SearchResult => !!r)
  }, [query, notes, objects, tags, sourceFilter, sort])

  // 无结果：语法提示（R16 语法示例）
  if (results.length === 0) {
    return (
      <Empty className="gap-2">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchIcon />
          </EmptyMedia>
          <EmptyTitle>未找到匹配的笔记</EmptyTitle>
          <EmptyDescription>
            <span className="block">
              试试语法组合（空格分隔，AND）：{' '}
              <span className="rounded bg-muted px-1 py-0.5 font-mono text-xs">type:book 注意力</span>
            </span>
            <span className="block">
              <span className="rounded bg-muted px-1 py-0.5 font-mono text-xs">#深度学习</span>{' '}
              按标签（含别名）
            </span>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          搜索结果 · {results.length}
          {sourceFilter !== 'all' && '（来源筛选）'}
        </span>
      </div>
      {/* presorted：搜索服务已按 ui.sort 排好（含 relevance 相关度），跳过列表内排序 */}
      <NoteCardList notes={results.map((r) => r.note)} crossObject presorted />
    </div>
  )
}

export default function ContentArea() {
  const view = useUiStore((s) => s.view)
  const editing = useUiStore((s) => s.editing)
  const searchActive = useUiStore((s) => s.search.active)
  const selectedObjectId = useUiStore((s) => s.selectedObjectId)
  const selectedTagId = useUiStore((s) => s.selectedTagId)
  const activeNoteId = useUiStore((s) => s.activeNoteId)

  // 编辑态：全内容区表单（800×600 下弹窗空间不足，design 交互细节 5）
  if (editing) {
    return editing.kind === 'object' ? <ObjectForm /> : <NoteForm />
  }

  // 笔记全文（R6 第二种内容形态）——优先于搜索态：搜索态点卡片进全文（AC9 只读），返回后回搜索结果
  if (activeNoteId) {
    return <NoteView noteId={activeNoteId} />
  }

  // 搜索态：阶段 7 子输入框驱动（setSubInput → ui.setSearch）
  if (searchActive) {
    return <SearchResults />
  }

  // 对象详情（R11）
  if (selectedObjectId) {
    return <ObjectDetail objectId={selectedObjectId} />
  }

  // 标签跨对象列表（R8：标签视图与首页钉住标签共用同一联动）
  if (selectedTagId) {
    return <TagNotesList tagId={selectedTagId} />
  }

  // 各视图空态
  if (view === 'home') {
    return (
      <Empty className="gap-2">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpenIcon />
          </EmptyMedia>
          <EmptyTitle>选择一个对象或标签开始</EmptyTitle>
          <EmptyDescription>
            在左侧选择钉住的对象或标签；或通过右上角「新建」创建第一个学习对象
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  if (view === 'tags') {
    return (
      <Empty className="gap-2">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TagIcon />
          </EmptyMedia>
          <EmptyTitle>选择左侧一个标签</EmptyTitle>
          <EmptyDescription>查看该标签跨对象的全部笔记卡片</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Empty className="gap-2">
      <EmptyHeader>
        <EmptyTitle>{view === 'archived' ? '归档视图' : '设置视图'}</EmptyTitle>
        <EmptyDescription>二期开放</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
