/**
 * stores/objects.ts —— 对象（对象笔记）域（design.md 第 2 节：objects 域）
 *
 * 契约：db.ts 是唯一写入口；本层负责内存同步与跨 store 一致性：
 * - 删除对象 → db 级联删笔记后，同步清理 notes 内存（remove）
 * - 归档自动取消钉住（R12：钉住/归档对象级互斥）
 * 消费方（阶段 4 对象详情 / 首页列表）通过本 store 的 selector 读取派生列表。
 */
import { create } from 'zustand'
import {
  createObject as dbCreateObject,
  deleteObjectCascade,
  listObjects,
  updateObject as dbUpdateObject,
} from '../services/db.ts'
import type { NoteObject, NoteObjectInput } from '../types.ts'
import { useNotesStore } from './notes.ts'

interface ObjectsState {
  /** 全量对象（含归档）；派生列表用下方 selector */
  objects: NoteObject[]
  /** bootstrap 是否已完成（UI 骨架加载态） */
  loaded: boolean

  /** bootstrap 全量注入（幂等：整体替换） */
  hydrate(objects: NoteObject[]): void
  /** 单域加载（独立刷新/测试用） */
  load(): Promise<void>
  getById(id: string): NoteObject | undefined
  create(input: NoteObjectInput): Promise<NoteObject>
  update(object: NoteObject): Promise<NoteObject>
  /** 删除对象并级联删除其下全部笔记（db 已级联；此处同步内存），返回删除的笔记数 */
  remove(objectId: string): Promise<number>
  /** 钉住/取消钉住（归档对象不允许钉住） */
  togglePinned(objectId: string): Promise<void>
  /** 归档/取消归档；归档时自动取消钉住（R12） */
  setArchived(objectId: string, archived: boolean): Promise<void>
  /** 删除标签后的对象引用清理（tags 域联动，含 db 写） */
  removeTagFromObjects(tagId: string): Promise<void>
}

export const useObjectsStore = create<ObjectsState>()((set, get) => ({
  objects: [],
  loaded: false,

  hydrate: (objects) => set({ objects, loaded: true }),

  load: async () => {
    const objects = await listObjects()
    set({ objects, loaded: true })
  },

  getById: (id) => get().objects.find((o) => o._id === id),

  create: async (input) => {
    const object = await dbCreateObject(input)
    set((s) => ({ objects: [...s.objects, object] }))
    return object
  },

  update: async (object) => {
    const updated = await dbUpdateObject(object)
    set((s) => ({
      objects: s.objects.map((o) => (o._id === updated._id ? updated : o)),
    }))
    return updated
  },

  remove: async (objectId) => {
    const count = await deleteObjectCascade(objectId)
    // db 已级联删除其下笔记，同步内存（跨 store 一致性）
    useNotesStore.getState().removeByObject(objectId)
    set((s) => ({ objects: s.objects.filter((o) => o._id !== objectId) }))
    return count
  },

  togglePinned: async (objectId) => {
    const obj = get().getById(objectId)
    if (!obj) return
    // 归档对象不可钉住（R12 互斥）
    if (obj.archived) return
    await get().update({ ...obj, pinned: !obj.pinned })
  },

  setArchived: async (objectId, archived) => {
    const obj = get().getById(objectId)
    if (!obj) return
    // 归档 = 自动取消钉住
    await get().update({ ...obj, archived, pinned: archived ? false : obj.pinned })
  },

  removeTagFromObjects: async (tagId) => {
    const affected = get().objects.filter((o) => o.tags.includes(tagId))
    if (affected.length === 0) return
    // 逐个经 db 更新（删除标签 = 遍历引用清理，量小可接受）
    const updated = await Promise.all(
      affected.map((o) =>
        dbUpdateObject({ ...o, tags: o.tags.filter((t) => t !== tagId) }),
      ),
    )
    set((s) => ({
      objects: s.objects.map((o) => updated.find((u) => u._id === o._id) ?? o),
    }))
  },
}))

// ---- 派生 selector（组件用 useObjectsStore(selectXxx) 或 useMemo 组合） ----

/** 未归档对象（首页全量/新建笔记联想用） */
export function selectActiveObjects(s: ObjectsState): NoteObject[] {
  return s.objects.filter((o) => !o.archived)
}

/** 钉住对象（R7 首页「钉住对象」区） */
export function selectPinnedObjects(s: ObjectsState): NoteObject[] {
  return s.objects.filter((o) => o.pinned && !o.archived)
}

/** 已归档对象（R9 归档视图侧边栏，二期） */
export function selectArchivedObjects(s: ObjectsState): NoteObject[] {
  return s.objects.filter((o) => o.archived)
}
