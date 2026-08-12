/**
 * components/DirtyGuard.tsx —— 未保存改动全局确认（R11/R12 草稿保护）
 *
 * 机制：编辑中的 NoteView/NoteForm 置 ui.pendingDirty；一切路由切换
 * （setView/selectObject/selectTag/closeNote/startEditing）经 ui.requestRoute
 * 包裹——pendingDirty 时请求暂存到 ui.dirtyRoute 而非直接执行。
 * 本组件监听 dirtyRoute：非空即弹 AlertDialog（放弃/取消）：
 * - 放弃：discardDirty() → 执行组件注册的 onDiscard 清理（清 localStorage 草稿）
 *   → 执行被暂存的路由请求
 * - 取消：cancelRoute() → 留在原处
 */
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
import { useUiStore } from '@/stores/ui'

export default function DirtyGuard() {
  const dirtyRoute = useUiStore((s) => s.dirtyRoute)
  const cancelRoute = useUiStore((s) => s.cancelRoute)
  const discardDirty = useUiStore((s) => s.discardDirty)

  return (
    <AlertDialog
      open={dirtyRoute !== null}
      onOpenChange={(open) => {
        // Esc / 遮罩点击 = 取消（留在原处）
        if (!open) cancelRoute()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>有未保存的改动</AlertDialogTitle>
          <AlertDialogDescription>
            离开将丢失当前未保存的修改。确定要放弃吗？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={discardDirty}>放弃更改</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
