/**
 * stores/tags.ts —— 标签域（design.md 第 2 节：tags 域）
 *
 * 契约：
 * - create 走 tagNormalize 归并语义（name/aliases 精确匹配 → canonical tagId，R15）
 * - remove 编排跨域清理：先清理 notes/objects 引用（含 db 写），再删标签文档
 * - 计数（R8 标签视图带笔记计数）为纯函数内存计算，组件 useMemo 消费
 */
import { create } from 'zustand'
import {
  createTag as dbCreateTag,
  deleteTag,
  listTags,
  updateTag as dbUpdateTag,
} from '../services/db.ts'
import { buildTagId, matchTag } from '../services/tagNormalize.ts'
import type { Note, Tag } from '../types.ts'
import { useNotesStore } from './notes.ts'
import { useObjectsStore } from './objects.ts'

interface TagsState {
  /** 全量标签实体 */
  tags: Tag[]
  /** bootstrap 是否已完成 */
  loaded: boolean

  /** bootstrap 全量注入（幂等：整体替换） */
  hydrate(tags: Tag[]): void
  /** 单域加载（独立刷新/测试用） */
  load(): Promise<void>
  getById(id: string): Tag | undefined
  /**
   * 新建标签（归并语义）：输入文本精确命中既有 name/aliases 则返回既有标签（不新建）；
   * 未命中则创建（slug 冲突由 buildTagId 加后缀）
   */
  create(input: { name: string; aliases?: string[] }): Promise<Tag>
  /** 编辑标签（改名/别名编辑）；改名走归并语义，冲突由调用方（阶段 6 UI）确认 */
  update(tag: Tag): Promise<Tag>
  /** 删除标签：先清理 notes/objects 引用（db + 内存），再删标签文档 */
  remove(tagId: string): Promise<void>
  /** 钉住/取消钉住（R7 首页「钉住标签」区） */
  togglePinned(tagId: string): Promise<void>
  /**
   * 批量文本 → canonical tagId 列表（去重，R15 归并语义）。
   * 表单组件（ObjectForm/NoteForm）的标签输入唯一写入口：
   * 逐项走 create（name/aliases 精确命中不重复建），同步 db + 内存。
   */
  resolveTagIds(texts: string[]): Promise<string[]>
}

export const useTagsStore = create<TagsState>()((set, get) => ({
  tags: [],
  loaded: false,

  hydrate: (tags) => set({ tags, loaded: true }),

  load: async () => {
    const tags = await listTags()
    set({ tags, loaded: true })
  },

  getById: (id) => get().tags.find((t) => t._id === id),

  create: async ({ name, aliases = [] }) => {
    const existing = matchTag(name, get().tags)
    if (existing) return existing // 归并：不重复建标签
    const tag = await dbCreateTag({
      id: buildTagId(name, get().tags),
      name,
      aliases,
    })
    set((s) => ({ tags: [...s.tags, tag] }))
    return tag
  },

  update: async (tag) => {
    const updated = await dbUpdateTag(tag)
    set((s) => ({ tags: s.tags.map((t) => (t._id === updated._id ? updated : t)) }))
    return updated
  },

  remove: async (tagId) => {
    // 跨域清理：笔记与对象的 tagId 引用（各含 db 写），再删标签本身
    await useNotesStore.getState().removeTagFromNotes(tagId)
    await useObjectsStore.getState().removeTagFromObjects(tagId)
    await deleteTag(tagId)
    set((s) => ({ tags: s.tags.filter((t) => t._id !== tagId) }))
  },

  togglePinned: async (tagId) => {
    const tag = get().getById(tagId)
    if (!tag) return
    await get().update({ ...tag, pinned: !tag.pinned })
  },

  resolveTagIds: async (texts) => {
    // 逐项归并（与 normalizeTags 同语义）：name 精确命中既有 name/aliases 归并，
    // 未命中则创建；同一批内后续输入能归并到本批刚创建的标签（tags 实时追加）。
    // 顺序执行是语义要求（每次 matchTag 须看到前一次新建的标签），非可并行循环。
    const tags = [...get().tags]
    const ids: string[] = []
    const seen = new Set<string>()
    let created = false
    for (const raw of texts) {
      const name = raw.trim()
      if (!name) continue
      const matched = matchTag(name, tags)
      const tag = matched ?? (await dbCreateTag({ id: buildTagId(name, tags), name }))
      if (tag !== matched) {
        tags.push(tag)
        created = true
      }
      if (!seen.has(tag._id)) {
        seen.add(tag._id)
        ids.push(tag._id)
      }
    }
    if (created) set({ tags })
    return ids
  },
}))

// ---- 派生 selector / 纯函数 ----

/** 钉住标签（R7 首页「钉住标签」区） */
export function selectPinnedTags(s: TagsState): Tag[] {
  return s.tags.filter((t) => t.pinned)
}

/**
 * 标签笔记计数（R8：标签视图侧边栏 name + 计数）。
 * 纯内存计算：每个笔记的 tags 数组命中 tagId 计 1（只计笔记，不计对象）。
 */
export function countNotesByTag(tags: Tag[], notes: Note[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const tag of tags) counts.set(tag._id, 0)
  for (const note of notes) {
    for (const tagId of note.tags) {
      if (counts.has(tagId)) counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
    }
  }
  return counts
}
