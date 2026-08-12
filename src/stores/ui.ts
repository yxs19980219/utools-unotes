/**
 * stores/ui.ts —— UI 状态（design.md 第 2 节：ui 域）
 *
 * 职责：当前视图、选中项（对象/标签/笔记）、搜索态、编辑态。
 * 跨视图语义：
 * - selectObject / selectTag 互斥（选中其一即清除另一），并关闭笔记全文
 * - setView 清空选中项与编辑态（每视图只显示自己的内容，R5）
 * - 搜索态由阶段 7 的子输入框驱动，这里先占位
 * - sort / sourceFilter（R17）：ContentHeader 写入、NoteCardList 消费；
 *   全局持久（跨视图保留偏好），relevance 仅搜索态启用（阶段 7）
 * - 实时保存时代无未保存确认机制（DirtyGuard 已删，08-12 任务）：
 *   路由切换直接执行，不弹确认框
 */
import { create } from 'zustand'
import type { Prefs, SearchSort } from '../types.ts'

/** 顶级视图（R5 分段控件）；archived/settings 为二期，UI 置灰 */
export type View = 'home' | 'tags' | 'archived' | 'settings'

/** 浏览视图（设置视图时侧边栏回显进入前的列表，R3） */
export type BrowseView = Exclude<View, 'settings'>

/** 搜索态（阶段 7 接入 setSubInput 后由服务层填充） */
export interface SearchState {
  active: boolean
  query: string
}

/** 编辑态：id 为 null 表示新建（kind=note 时新建笔记，kind=object 时新建对象） */
export interface EditingState {
  kind: 'object' | 'note'
  /** 被编辑文档 _id；null = 新建 */
  id: string | null
}

interface UiState {
  view: View
  /** 当前选中的对象 _id（首页/归档视图内容区联动） */
  selectedObjectId: string | null
  /** 当前选中的标签 _id（首页/标签视图内容区联动） */
  selectedTagId: string | null
  /** 当前打开的笔记全文 _id（阶段 5 使用） */
  activeNoteId: string | null
  search: SearchState
  editing: EditingState | null
  /** 当前列表排序（R17；relevance 阶段 7 搜索态启用） */
  sort: SearchSort
  /** 进入搜索前的浏览态排序（退出搜索时恢复，relevance 仅搜索态有效） */
  preSearchSort: SearchSort
  /** 当前来源类型筛选（'all' = 不过滤；仅跨对象列表语境生效） */
  sourceFilter: string
  /** 浏览视图记录（R3：进入设置时保留，设置视图侧边栏回显该列表） */
  lastBrowseView: BrowseView

  /** 偏好默认排序应用（R9：启动时 bootstrap 调用 / 设置页保存时调用） */
  applyPrefs(prefs: Prefs): void

  setView(view: View): void
  setSort(sort: SearchSort): void
  setSourceFilter(sourceFilter: string): void
  /** 选中对象（清除标签选中与笔记全文）；null = 取消选中 */
  selectObject(objectId: string | null): void
  /** 选中标签（清除对象选中与笔记全文）；null = 取消选中 */
  selectTag(tagId: string | null): void
  openNote(noteId: string): void
  closeNote(): void
  setSearch(active: boolean, query?: string): void
  /** 进入编辑态；id 为 null 表示新建 */
  startEditing(kind: 'object' | 'note', id?: string | null): void
  /** 退出编辑态（保存/取消后均调用） */
  stopEditing(): void
}

export const useUiStore = create<UiState>()((set, get) => ({
  view: 'home',
  selectedObjectId: null,
  selectedTagId: null,
  activeNoteId: null,
  search: { active: false, query: '' },
  editing: null,
  sort: 'updated',
  preSearchSort: 'updated',
  sourceFilter: 'all',
  lastBrowseView: 'home',

  setSort: (sort) => set({ sort }),
  setSourceFilter: (sourceFilter) => set({ sourceFilter }),

  applyPrefs: (prefs) =>
    set((s) => ({
      // relevance 仅搜索态，不被偏好覆盖（preSearchSort 始终恢复浏览态偏好）
      sort: s.sort === 'relevance' ? s.sort : prefs.defaultSort,
      preSearchSort: prefs.defaultSort,
    })),

  setView: (view) => {
    // 切视图退出搜索态（R5：每视图只显示自己的内容）
    get().setSearch(false)
    set((s) => ({
      view,
      selectedObjectId: null,
      selectedTagId: null,
      activeNoteId: null,
      editing: null,
      // R3：浏览视图才记录；进入设置时保留上一个浏览视图
      lastBrowseView: view !== 'settings' ? view : s.lastBrowseView,
    }))
  },

  selectObject: (objectId) => {
    // 侧边栏选中对象即退出搜索态（内容区切回对象详情）
    get().setSearch(false)
    set({
      selectedObjectId: objectId,
      selectedTagId: null,
      activeNoteId: null,
    })
  },

  selectTag: (tagId) => {
    // 侧边栏选中标签即退出搜索态（内容区切回标签列表）
    get().setSearch(false)
    set({
      selectedTagId: tagId,
      selectedObjectId: null,
      activeNoteId: null,
    })
  },

  openNote: (noteId) => set({ activeNoteId: noteId }),
  closeNote: () => set({ activeNoteId: null }),

  /**
   * 搜索态（阶段 7 子输入框驱动）：
   * - 进入（active 从 false → true）：记住浏览态排序，默认切 relevance（相关度）
   * - 退出（active → false）：恢复浏览态排序偏好
   * - 搜索态内 query 变化：关闭已打开的笔记全文（回到结果列表）
   */
  setSearch: (active, query = '') =>
    set((s) => {
      if (active && !s.search.active) {
        return {
          search: { active, query },
          preSearchSort: s.sort,
          sort: 'relevance',
          activeNoteId: null,
        }
      }
      if (!active && s.search.active) {
        return { search: { active, query }, sort: s.preSearchSort }
      }
      if (active && query !== s.search.query) {
        return { search: { active, query }, activeNoteId: null }
      }
      return { search: { active, query } }
    }),

  startEditing: (kind, id = null) => set({ editing: { kind, id } }),
  stopEditing: () => set({ editing: null }),
}))
