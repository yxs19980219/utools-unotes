/**
 * components/SidebarList.tsx —— 侧边栏视图列表区（阶段 4：点击联动 + 选中高亮）
 *
 * - 首页：钉住对象（图标 = 来源类型映射）+ 钉住标签分组；点击 → selectObject/selectTag；
 *   无钉住时 Empty 引导 CTA「新建对象」→ startEditing('object', null)（4a）
 * - 标签：全部标签（name + 计数 Badge），点击 → selectTag，高亮联动（4a/R8）
 * - 归档/设置：二期占位（触发入口已置灰，此处兜底）
 */
import { useMemo } from 'react'
import { PinIcon, PlusIcon, TagIcon } from 'lucide-react'

import SidebarRow from '@/components/SidebarRow'
import TagRowActions from '@/components/TagRowActions'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { sourceTypeIcon } from '@/lib/sourceTypes'
import { useNotesStore } from '@/stores/notes'
import { selectPinnedObjects, useObjectsStore } from '@/stores/objects'
import { countNotesByTag, selectPinnedTags, useTagsStore } from '@/stores/tags'
import { useUiStore } from '@/stores/ui'
import type { Tag } from '@/types'

/** 标签行（阶段 6：悬停 ⋯ 操作 + 选中高亮；首页钉住区与标签视图共用，交互一致） */
function TagSidebarRow({
  tag,
  badge,
  active,
  onClick,
}: {
  tag: Tag
  badge?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <SidebarRow
      icon={<TagIcon />}
      label={tag.name}
      badge={badge}
      active={active}
      onClick={onClick}
      actions={<TagRowActions tagId={tag._id} />}
    />
  )
}

/** 分组小标题（钉住对象 / 钉住标签） */
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-1.5 pt-2 pb-1 text-xs font-medium text-muted-foreground/80">
      {children}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 p-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-7 w-full rounded-md" />
      ))}
    </div>
  )
}

/** 首页：钉住对象 + 钉住标签（R7），点击联动 selectObject/selectTag */
function HomeSidebarGroups() {
  const loaded = useObjectsStore((s) => s.loaded) && useTagsStore((s) => s.loaded)
  const pinnedObjects = useObjectsStore(selectPinnedObjects)
  const pinnedTags = useTagsStore(selectPinnedTags)
  const selectedObjectId = useUiStore((s) => s.selectedObjectId)
  const selectedTagId = useUiStore((s) => s.selectedTagId)
  const selectObject = useUiStore((s) => s.selectObject)
  const selectTag = useUiStore((s) => s.selectTag)
  const startEditing = useUiStore((s) => s.startEditing)

  if (!loaded) return <ListSkeleton />
  if (pinnedObjects.length === 0 && pinnedTags.length === 0) {
    return (
      <Empty className="gap-2 p-3">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PinIcon />
          </EmptyMedia>
          <EmptyTitle>还没有钉住的内容</EmptyTitle>
          <EmptyDescription>
            新建对象后在其详情页钉住，即可在这里快速直达
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-col items-center gap-1.5">
          <Button size="sm" onClick={() => startEditing('object', null)}>
            <PlusIcon data-icon />
            新建对象
          </Button>
          <span className="text-xs text-muted-foreground">或从右上角「新建」开始</span>
        </div>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      {pinnedObjects.length > 0 && (
        <>
          <SectionLabel>钉住对象</SectionLabel>
          {pinnedObjects.map((o) => {
            const Icon = sourceTypeIcon(o.sourceType)
            return (
              <SidebarRow
                key={o._id}
                icon={<Icon />}
                label={o.title}
                active={selectedObjectId === o._id}
                onClick={() => selectObject(o._id)}
              />
            )
          })}
        </>
      )}
      {pinnedTags.length > 0 && (
        <>
          <SectionLabel>钉住标签</SectionLabel>
          {pinnedTags.map((t) => (
            <TagSidebarRow
              key={t._id}
              tag={t}
              active={selectedTagId === t._id}
              onClick={() => selectTag(t._id)}
            />
          ))}
        </>
      )}
    </div>
  )
}

/** 标签视图：全部标签 + 计数（R8），点击 → selectTag */
function TagsSidebarList() {
  const loaded = useTagsStore((s) => s.loaded)
  const tags = useTagsStore((s) => s.tags)
  const notes = useNotesStore((s) => s.notes)
  const selectedTagId = useUiStore((s) => s.selectedTagId)
  const selectTag = useUiStore((s) => s.selectTag)
  const counts = useMemo(() => countNotesByTag(tags, notes), [tags, notes])
  const sorted = useMemo(
    () => [...tags].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [tags],
  )

  if (!loaded) return <ListSkeleton />
  if (sorted.length === 0) {
    return (
      <Empty className="gap-2 p-3">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TagIcon />
          </EmptyMedia>
          <EmptyTitle>还没有标签</EmptyTitle>
          <EmptyDescription>新建笔记时输入标签即可创建</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      {sorted.map((t) => (
        <TagSidebarRow
          key={t._id}
          tag={t}
          badge={counts.get(t._id) ?? 0}
          active={selectedTagId === t._id}
          onClick={() => selectTag(t._id)}
        />
      ))}
    </div>
  )
}

export default function SidebarList() {
  const view = useUiStore((s) => s.view)

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex min-h-full flex-col p-2">
        {view === 'home' && <HomeSidebarGroups />}
        {view === 'tags' && <TagsSidebarList />}
        {(view === 'archived' || view === 'settings') && (
          <Empty className="gap-2 p-3">
            <EmptyHeader>
              <EmptyTitle>{view === 'archived' ? '归档视图' : '设置视图'}</EmptyTitle>
              <EmptyDescription>二期开放</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </ScrollArea>
  )
}
