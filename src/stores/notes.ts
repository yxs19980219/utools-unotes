/**
 * stores/notes.ts —— 普通笔记域（design.md 第 2 节：notes 域）
 *
 * 契约：
 * - create 强校验归属对象存在（AC10 数据层兜底；UI 编辑态强提示在前）
 * - 对象删除的级联由 objects 域触发（removeByObject 只同步内存，db 已删）
 * - 标签删除的引用清理（removeTagFromNotes）含 db 写，由 tags 域编排调用
 */
import { create } from 'zustand'
import {
  createNote as dbCreateNote,
  deleteNote,
  getObject,
  listNotes,
  updateNote as dbUpdateNote,
} from '../services/db.ts'
import type { Note, NoteInput, NoteObject } from '../types.ts'

interface NotesState {
  /** 全量笔记（含归档对象的笔记，R13：归档是状态不是隔离区） */
  notes: Note[]
  /** bootstrap 是否已完成 */
  loaded: boolean

  /** bootstrap 全量注入（幂等：整体替换） */
  hydrate(notes: Note[]): void
  /** 单域加载（独立刷新/测试用） */
  load(): Promise<void>
  getById(id: string): Note | undefined
  create(input: NoteInput): Promise<Note>
  update(note: Note): Promise<Note>
  remove(noteId: string): Promise<void>
  /** 对象级联删除后的内存同步（db 已由 deleteObjectCascade 完成） */
  removeByObject(objectId: string): void
  /** 删除标签时清理笔记引用（遍历受影响笔记写 db + 同步内存），由 tags 域调用 */
  removeTagFromNotes(tagId: string): Promise<void>
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: [],
  loaded: false,

  hydrate: (notes) => set({ notes, loaded: true }),

  load: async () => {
    const notes = await listNotes()
    set({ notes, loaded: true })
  },

  getById: (id) => get().notes.find((n) => n._id === id),

  create: async (input) => {
    // AC10 强约束：笔记必须归属已存在对象（以 db 为事实源，不依赖内存加载时序）
    const object = await getObject(input.objectId)
    if (!object) {
      throw new Error('笔记必须归属一个存在的对象（AC10）')
    }
    const note = await dbCreateNote(input)
    set((s) => ({ notes: [...s.notes, note] }))
    return note
  },

  update: async (note) => {
    const updated = await dbUpdateNote(note)
    set((s) => ({
      notes: s.notes.map((n) => (n._id === updated._id ? updated : n)),
    }))
    return updated
  },

  remove: async (noteId) => {
    const note = get().getById(noteId)
    if (!note) return
    await deleteNote(noteId)
    set((s) => ({ notes: s.notes.filter((n) => n._id !== noteId) }))
  },

  removeByObject: (objectId) =>
    set((s) => ({
      notes: s.notes.filter((n) => n.objectId !== objectId),
    })),

  removeTagFromNotes: async (tagId) => {
    const affected = get().notes.filter((n) => n.tags.includes(tagId))
    if (affected.length === 0) return
    // 逐个经 db 更新（删除标签 = 遍历引用清理，量小可接受）
    const updated = await Promise.all(
      affected.map((n) =>
        dbUpdateNote({ ...n, tags: n.tags.filter((t) => t !== tagId) }),
      ),
    )
    set((s) => ({
      notes: s.notes.map((n) => updated.find((u) => u._id === n._id) ?? n),
    }))
  },
}))

// ---- 派生 selector（组件用 useMemo(selectNotesByXxx, [notes, ...]) 组合） ----

/** 某对象下的全部笔记（阶段 4 对象详情卡片流） */
export function selectNotesByObject(s: NotesState, objectId: string): Note[] {
  return s.notes.filter((n) => n.objectId === objectId)
}

/** 挂某标签的笔记（跨对象，R8 标签视图内容区） */
export function selectNotesByTag(s: NotesState, tagId: string): Note[] {
  return s.notes.filter((n) => n.tags.includes(tagId))
}

/**
 * 来源类型筛选（R17 AND 语义；标签跨对象列表/搜索态共用）。
 * sourceFilter === 'all' 时不过滤；objectById 缺失（对象已删）的笔记保留不过滤。
 */
export function filterNotesBySource(
  notes: Note[],
  objectById: Map<string, NoteObject>,
  sourceFilter: string,
): Note[] {
  if (sourceFilter === 'all') return notes
  return notes.filter((n) => objectById.get(n.objectId)?.sourceType === sourceFilter)
}
