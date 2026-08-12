/**
 * components/ObjectDetail.tsx —— 对象详情内容区（三期：顶栏信息上移 ContentHeader 后瘦身）
 *
 * 三期重构：标题/笔记数/元数据/操作（排序/新笔记/归档/编辑/删除/恢复）全部收敛到
 * ContentHeader 的对象详情顶栏（ObjectHeaderActions）；本组件仅渲染笔记卡片流。
 * 归档对象的只读语义由 NoteCardList（隐藏编辑）+ NoteView（readonly）保证。
 */
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import NoteCardList from '@/components/NoteCardList'
import { selectNotesByObject, useNotesStore } from '@/stores/notes'
import { useObjectsStore } from '@/stores/objects'
import { useShallow } from 'zustand/react/shallow'

export default function ObjectDetail({ objectId }: { objectId: string }) {
  const object = useObjectsStore((s) => s.objects.find((o) => o._id === objectId))
  const notes = useNotesStore(useShallow((s) => selectNotesByObject(s, objectId)))

  if (!object) {
    return (
      <Empty className="gap-2">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <span className="text-lg leading-none">📦</span>
          </EmptyMedia>
          <EmptyTitle>对象不存在或已删除</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return <NoteCardList notes={notes} />
}
