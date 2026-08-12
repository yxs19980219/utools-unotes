/**
 * components/NoteFormDialog.tsx —— 笔记表单小窗（08-12，R7）
 *
 * 新建/编辑笔记由全内容区表单改为 Dialog 小窗（800×600 下不占满窗口）。
 * - Dialog 内容 = NoteForm（字段 + 保存/取消在窗内底部）
 * - Esc / 遮罩点击 / 取消 → stopEditing（无 dirty 确认，实时保存时代）
 * - 对象表单（ObjectForm）保持全内容区（字段多，见 ContentArea 路由）
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import NoteForm from '@/components/NoteForm'
import { useUiStore } from '@/stores/ui'

export default function NoteFormDialog() {
  const editing = useUiStore((s) => s.editing)
  const stopEditing = useUiStore((s) => s.stopEditing)

  return (
    <Dialog
      open={editing?.kind === 'note'}
      onOpenChange={(open) => {
        // Esc / 遮罩点击关闭 → 退出编辑态
        if (!open) stopEditing()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing?.id ? '编辑笔记' : '新建笔记'}</DialogTitle>
        </DialogHeader>
        <NoteForm />
      </DialogContent>
    </Dialog>
  )
}
