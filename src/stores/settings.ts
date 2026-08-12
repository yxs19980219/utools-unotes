/**
 * stores/settings.ts —— 设置域（二期：来源类型枚举 + 偏好）
 *
 * 职责（design.md 第 2 节：settings 域）：
 * - 来源类型枚举：单一数据源（R8），设置页增删改即时生效于
 *   新建对象来源下拉（ObjectForm）与内容区来源筛选器（ContentHeader）
 * - 偏好：默认排序（R9），持久化到 setting/prefs
 * 契约：db.ts 是唯一写入口，先 db 后内存（与其余域一致）；
 * bootstrap 时 load() 一次拉全量（sourceTypes + prefs）。
 * 内置类型锁定（R7 决策）：不可删、不可改名；自定义类型可增删改。
 */
import { create } from 'zustand'
import {
  countObjectsBySourceType,
  getSetting,
  getSourceTypes,
  saveSetting,
  saveSourceTypes,
  slugify,
} from '../services/db.ts'
import type { Prefs, SourceType } from '../types.ts'
import { BUILTIN_SOURCE_TYPES } from '../types.ts'

/** 偏好默认值（无 setting/prefs 文档时） */
export const DEFAULT_PREFS: Prefs = { defaultSort: 'updated' }

/** 来源类型 id 生成：slugify(label) 唯一化（撞 id 时追加 -n 后缀） */
function nextTypeId(label: string, existing: SourceType[]): string {
  const base = slugify(label) || 'custom'
  let id = base
  let n = 2
  while (existing.some((st) => st.id === id)) {
    id = `${base}-${n}`
    n += 1
  }
  return id
}

interface SettingsState {
  /** 全量来源类型（内置 + 自定义） */
  sourceTypes: SourceType[]
  prefs: Prefs
  /** bootstrap 是否已完成 */
  loaded: boolean

  /** bootstrap 全量加载（sourceTypes + prefs，幂等） */
  load(): Promise<void>
  getById(id: string): SourceType | undefined
  /** 新增自定义类型：label 精确去重（拒绝与既有类型同名） */
  addSourceType(label: string): Promise<SourceType>
  /** 重命名（仅自定义类型；内置锁定） */
  renameSourceType(id: string, label: string): Promise<void>
  /** 删除类型（仅自定义；允许强制删除，被引用对象保留原字符串，AC5） */
  removeSourceType(id: string): Promise<void>
  /** 删除确认用：引用该类型的对象数 */
  countReferences(id: string): Promise<number>
  savePrefs(prefs: Prefs): Promise<void>
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  sourceTypes: [...BUILTIN_SOURCE_TYPES],
  prefs: { ...DEFAULT_PREFS },
  loaded: false,

  load: async () => {
    const [types, prefsSetting] = await Promise.all([
      getSourceTypes(),
      getSetting('prefs'),
    ])
    const raw = prefsSetting?.value as { defaultSort?: unknown } | undefined
    const defaultSort = raw?.defaultSort
    const prefs: Prefs =
      defaultSort === 'updated' || defaultSort === 'created' || defaultSort === 'title'
        ? { defaultSort }
        : { ...DEFAULT_PREFS }
    set({ sourceTypes: types, prefs, loaded: true })
  },

  getById: (id) => get().sourceTypes.find((st) => st.id === id),

  addSourceType: async (label) => {
    const name = label.trim()
    if (!name) throw new Error('类型名称不能为空')
    if (get().sourceTypes.some((st) => st.label === name)) {
      throw new Error(`类型「${name}」已存在`)
    }
    const st: SourceType = { id: nextTypeId(name, get().sourceTypes), label: name, builtin: false }
    // 先 db 后内存
    await saveSourceTypes([...get().sourceTypes, st])
    set((s) => ({ sourceTypes: [...s.sourceTypes, st] }))
    return st
  },

  renameSourceType: async (id, label) => {
    const name = label.trim()
    const st = get().getById(id)
    if (!st) return
    if (st.builtin) throw new Error('内置类型不可改名')
    if (!name) throw new Error('类型名称不能为空')
    if (get().sourceTypes.some((t) => t.id !== id && t.label === name)) {
      throw new Error(`类型「${name}」已存在`)
    }
    const updated: SourceType = { ...st, label: name }
    await saveSourceTypes(get().sourceTypes.map((t) => (t.id === id ? updated : t)))
    set((s) => ({ sourceTypes: s.sourceTypes.map((t) => (t.id === id ? updated : t)) }))
  },

  removeSourceType: async (id) => {
    const st = get().getById(id)
    if (!st) return
    if (st.builtin) throw new Error('内置类型不可删除')
    await saveSourceTypes(get().sourceTypes.filter((t) => t.id !== id))
    set((s) => ({ sourceTypes: s.sourceTypes.filter((t) => t.id !== id) }))
  },

  countReferences: (id) => countObjectsBySourceType(id),

  savePrefs: async (prefs) => {
    await saveSetting('prefs', prefs)
    set({ prefs })
  },
}))
