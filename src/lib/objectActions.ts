/**
 * lib/objectActions.ts —— 对象生命周期操作（三期：侧边栏右键菜单 + 详情顶栏共用）
 *
 * 统一编排：store action（先 db 后内存）+ toast 反馈（成功/失败，规范：禁止静默吞错）。
 * 返回值 = 是否成功，调用方据此关闭确认框 / 复位 busy。
 */
import { toast } from 'sonner'

import { useNotesStore } from '@/stores/notes'
import { useObjectsStore } from '@/stores/objects'
import { useUiStore } from '@/stores/ui'

/** 归档对象（活跃 → 归档只读）；失败返回 false */
export async function archiveObject(objectId: string): Promise<boolean> {
  const obj = useObjectsStore.getState().getById(objectId)
  if (!obj) return false
  const count = useNotesStore.getState().notes.filter((n) => n.objectId === objectId).length
  try {
    await useObjectsStore.getState().setArchived(objectId, true)
    toast.success(`已归档「${obj.title}」（${count} 条笔记转只读）`)
    return true
  } catch (err) {
    toast.error(`归档失败：${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/** 恢复对象（归档 → 活跃，立即回首页活跃列表）；失败返回 false */
export async function restoreObject(objectId: string): Promise<boolean> {
  const obj = useObjectsStore.getState().getById(objectId)
  if (!obj) return false
  try {
    await useObjectsStore.getState().setArchived(objectId, false)
    toast.success(`已恢复「${obj.title}」`)
    return true
  } catch (err) {
    toast.error(`恢复失败：${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/** 删除对象（级联删笔记，返回删除的笔记数）；失败返回 -1 */
export async function removeObjectWithToast(objectId: string): Promise<number> {
  const obj = useObjectsStore.getState().getById(objectId)
  if (!obj) return -1
  try {
    const count = await useObjectsStore.getState().remove(objectId)
    toast.success(`已删除对象「${obj.title}」及 ${count} 条笔记`)
    // 删除的是当前选中对象 → 清内容区（避免残留「对象不存在」态）
    if (useUiStore.getState().selectedObjectId === objectId) {
      useUiStore.getState().selectObject(null)
    }
    return count
  } catch (err) {
    toast.error(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    return -1
  }
}
