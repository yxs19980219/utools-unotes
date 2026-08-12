/**
 * SourceNote 数据模型 —— schema v1（utools.db 文档类型）
 *
 * 存储契约（design.md 第 3 节）：
 * - _id 前缀分类：`object/`、`note/`、`tag/`、`setting/`
 * - 笔记/对象的 `tags` 存 canonical tagId（非名称）→ 标签重命名/别名编辑 O(1)
 * - 对象是钉住与归档的生命周期单元；笔记必须归属对象（AC10）
 * - 全部写操作经 utools.db promises API，更新必须带 `_rev`
 */

/** 来源元数据（统一结构，按来源类型选择性填写） */
export interface SourceMeta {
  /** 作者/演讲者/维护者 */
  author?: string
  /** 链接（论文 DOI、GitHub 仓库、视频地址等） */
  url?: string
  /** 年份 */
  year?: string
  /** 其他补充（出版社、期刊、平台等） */
  extra?: string
}

/** 对象（对象笔记）：生命周期单元，钉住/归档作用于此 */
export interface NoteObject {
  _id: string
  _rev?: string
  /** 书名/课程名/项目名 */
  title: string
  /** 来源类型 id（内置枚举或用户自定义，见 SourceType） */
  sourceType: string
  sourceMeta: SourceMeta
  /** canonical tagId 列表 */
  tags: string[]
  pinned: boolean
  archived: boolean
  createdAt: number
  updatedAt: number
}

/** 普通笔记：挂在对象下，正文为纯 Markdown */
export interface Note {
  _id: string
  _rev?: string
  /** 归属对象 _id（必填，AC10） */
  objectId: string
  title: string
  /** Markdown 正文 */
  content: string
  /** canonical tagId 列表 */
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** 标签实体：独立存储，笔记/对象通过 tagId 引用 */
export interface Tag {
  _id: string
  _rev?: string
  /** 规范名，如「深度学习」 */
  name: string
  /** 别名，如 ["deep learning", "DL"] */
  aliases: string[]
  /**
   * 钉住标签（R7 首页「钉住标签」区；schema v1.1 增量，向后兼容：
   * 老文档缺省 undefined 等价 false）
   */
  pinned?: boolean
  createdAt: number
}

/** 设置文档：_id 为 `setting/<key>`，value 按 key 约定结构 */
export interface Setting {
  _id: string
  _rev?: string
  value: unknown
  updatedAt: number
}

/** 来源类型枚举项（R4）：内置六种 + 用户自定义（设置页增删改） */
export interface SourceType {
  /** 内置: book | article | video | paper | github | course；自定义为生成 id */
  id: string
  /** 展示名，如「书籍」「播客」 */
  label: string
  /** 内置类型不可删除（可改名否见设置页规则） */
  builtin: boolean
}

/** 设置文档 key 常量 */
export const SETTING_KEYS = {
  sourceTypes: 'sourceTypes',
} as const

/** 内置来源类型默认枚举（R4） */
export const BUILTIN_SOURCE_TYPES: SourceType[] = [
  { id: 'book', label: '书籍', builtin: true },
  { id: 'article', label: '文章', builtin: true },
  { id: 'video', label: '视频', builtin: true },
  { id: 'paper', label: '论文', builtin: true },
  { id: 'github', label: 'GitHub', builtin: true },
  { id: 'course', label: '课程', builtin: true },
]

/** 新建对象的输入（未含 _id/时间戳/归档等系统字段） */
export interface NoteObjectInput {
  title: string
  sourceType: string
  sourceMeta?: SourceMeta
  tags?: string[]
  pinned?: boolean
}

/** 新建笔记的输入（未含 _id/时间戳） */
export interface NoteInput {
  objectId: string
  title: string
  content: string
  tags?: string[]
}

/** 搜索结果中的排序/相关度模型（design.md 第 4 节） */
export type SearchSort = 'updated' | 'created' | 'title' | 'relevance'
