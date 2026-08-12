/**
 * services/db.ts —— utools.db 封装（数据层唯一写入口）
 *
 * 契约（design.md 第 3 节、utools-api.md 本地数据库章节）：
 * - 全部走 promises API；更新必须带 `_rev`（缺 `_rev` 的更新 put 会失败）
 * - `_id` 前缀分类：object/ | note/ | tag/ | setting/
 * - 类型守卫（isNoteDoc 等）是本层唯一契约 owner，消费方禁止自行收窄 DbDoc
 * - 无 uTools 环境（node 纯逻辑测试）时降级为内存实现，行为对齐真实 API
 */
import type {
  Note,
  NoteInput,
  NoteObject,
  NoteObjectInput,
  Setting,
  SourceType,
  Tag,
} from '../types.ts'
import { BUILTIN_SOURCE_TYPES, SETTING_KEYS } from '../types.ts'

/** uTools 环境可用性（浏览器外 / node 测试环境为 false） */
export const isUtoolsAvailable =
  typeof utools !== 'undefined' && typeof utools.db?.promises !== 'undefined'

/** _id 前缀常量（跨层契约，消费方不得硬编码字符串） */
export const ID_PREFIX = {
  object: 'object/',
  note: 'note/',
  tag: 'tag/',
  setting: 'setting/',
} as const

export type DbDoc = { _id: string; _rev?: string }

export interface DbResult {
  id: string
  rev?: string
  ok?: boolean
  error?: boolean
  name?: string
  message?: string
}

/** 底层数据库适配器（真实 uTools / 内存模拟） */
export interface DbAdapter {
  put(doc: DbDoc): Promise<DbResult>
  get(id: string): Promise<DbDoc | null>
  remove(docOrId: DbDoc | string): Promise<DbResult>
  allDocs(idStartsWith?: string): Promise<DbDoc[]>
}

/** 真实实现：utools.db promises API */
class UtoolsDb implements DbAdapter {
  async put(doc: DbDoc): Promise<DbResult> {
    return utools.db.promises.put(doc)
  }
  async get(id: string): Promise<DbDoc | null> {
    return utools.db.promises.get(id)
  }
  async remove(docOrId: DbDoc | string): Promise<DbResult> {
    return utools.db.promises.remove(docOrId)
  }
  async allDocs(idStartsWith?: string): Promise<DbDoc[]> {
    return utools.db.promises.allDocs(idStartsWith)
  }
}

/**
 * 内存实现：无 uTools 环境时的防御降级（node 直测 / 纯逻辑测试）。
 * 行为对齐真实 API：更新不带 _rev 返回 conflict；删除不存在的 id 返回 not_found。
 */
class MemoryDb implements DbAdapter {
  private store = new Map<string, DbDoc>()
  private revSeq = 0

  async put(doc: DbDoc): Promise<DbResult> {
    if (this.store.has(doc._id) && !doc._rev) {
      return { id: doc._id, error: true, name: 'conflict', message: 'Document update conflict: _rev required' }
    }
    this.revSeq += 1
    const stored: DbDoc = { ...doc, _rev: `${this.revSeq}-mem` }
    this.store.set(doc._id, stored)
    return { id: doc._id, rev: stored._rev, ok: true }
  }
  async get(id: string): Promise<DbDoc | null> {
    return this.store.get(id) ?? null
  }
  async remove(docOrId: DbDoc | string): Promise<DbResult> {
    const id = typeof docOrId === 'string' ? docOrId : docOrId._id
    if (!this.store.delete(id)) {
      return { id, error: true, name: 'not_found', message: 'missing' }
    }
    return { id, ok: true }
  }
  async allDocs(idStartsWith?: string): Promise<DbDoc[]> {
    const docs = [...this.store.values()]
    if (idStartsWith === undefined) return docs
    return docs.filter((d) => d._id.startsWith(idStartsWith))
  }
}

let adapter: DbAdapter | null = null

/** 获取适配器单例：uTools 环境优先，否则内存实现 */
export function getDb(): DbAdapter {
  if (!adapter) {
    adapter = isUtoolsAvailable ? new UtoolsDb() : new MemoryDb()
  }
  return adapter
}

/** 重置适配器（测试用） */
export function resetDbForTest(): void {
  adapter = null
}

function newId(prefix: string): string {
  return `${prefix}${crypto.randomUUID()}`
}

function now(): number {
  return Date.now()
}

function assertOk(result: DbResult): void {
  if (!result.ok) {
    throw new Error(`db ${result.name ?? 'error'}: ${result.message ?? result.id}`)
  }
}

// ---------------------------------------------------------------------------
// 类型守卫（本层契约 owner：消费方收窄 DbDoc 必须经由这些守卫）
// ---------------------------------------------------------------------------

export function isNoteDoc(d: DbDoc): d is Note {
  return d._id.startsWith(ID_PREFIX.note) && typeof (d as Note).objectId === 'string'
}
export function isObjectDoc(d: DbDoc): d is NoteObject {
  return d._id.startsWith(ID_PREFIX.object) && typeof (d as NoteObject).sourceType === 'string'
}
export function isTagDoc(d: DbDoc): d is Tag {
  return d._id.startsWith(ID_PREFIX.tag) && typeof (d as Tag).name === 'string'
}
export function isSettingDoc(d: DbDoc): d is Setting {
  return d._id.startsWith(ID_PREFIX.setting)
}

// ---------------------------------------------------------------------------
// 领域 CRUD（对象 / 笔记 / 标签 / 设置）
// ---------------------------------------------------------------------------

async function putDoc<T extends DbDoc>(doc: T): Promise<T> {
  const result = await getDb().put(doc)
  assertOk(result)
  return { ...doc, _rev: result.rev } as T
}

async function removeById(id: string): Promise<void> {
  const result = await getDb().remove(id)
  // 幂等容错：not_found 视为删除成功（级联删除重试不抛错）
  if (result.error && result.name === 'not_found') return
  assertOk(result)
}

// ---- 对象 ----

export async function getObject(id: string): Promise<NoteObject | null> {
  const doc = await getDb().get(id)
  return doc && isObjectDoc(doc) ? doc : null
}

export async function listObjects(): Promise<NoteObject[]> {
  const docs = await getDb().allDocs(ID_PREFIX.object)
  return docs.filter(isObjectDoc)
}

export async function createObject(input: NoteObjectInput): Promise<NoteObject> {
  const t = now()
  const doc: NoteObject = {
    _id: newId(ID_PREFIX.object),
    title: input.title.trim(),
    sourceType: input.sourceType,
    sourceMeta: input.sourceMeta ?? {},
    tags: input.tags ?? [],
    pinned: input.pinned ?? false,
    archived: false,
    createdAt: t,
    updatedAt: t,
  }
  return putDoc(doc)
}

/** 更新对象：更新必须携带 _rev；缺 _rev 时先读库补齐（容错） */
export async function updateObject(object: NoteObject): Promise<NoteObject> {
  const doc = object._rev ? object : ((await getObject(object._id)) ?? object)
  return putDoc({ ...doc, updatedAt: now() })
}

/** 删除对象并级联删除其下全部笔记（设计文档：对象删除 = 级联，UI 负责确认数量） */
export async function deleteObjectCascade(objectId: string): Promise<number> {
  const notes = (await listNotes()).filter((n) => n.objectId === objectId)
  for (const n of notes) {
    await removeById(n._id)
  }
  await removeById(objectId)
  return notes.length
}

// ---- 笔记 ----

export async function getNote(id: string): Promise<Note | null> {
  const doc = await getDb().get(id)
  return doc && isNoteDoc(doc) ? doc : null
}

export async function listNotes(): Promise<Note[]> {
  const docs = await getDb().allDocs(ID_PREFIX.note)
  return docs.filter(isNoteDoc)
}

export async function createNote(input: NoteInput): Promise<Note> {
  const t = now()
  const doc: Note = {
    _id: newId(ID_PREFIX.note),
    objectId: input.objectId,
    title: input.title.trim(),
    content: input.content,
    tags: input.tags ?? [],
    createdAt: t,
    updatedAt: t,
  }
  return putDoc(doc)
}

export async function updateNote(note: Note): Promise<Note> {
  const doc = note._rev ? note : ((await getNote(note._id)) ?? note)
  return putDoc({ ...doc, updatedAt: now() })
}

export async function deleteNote(id: string): Promise<void> {
  await removeById(id)
}

// ---- 标签 ----

export async function getTag(id: string): Promise<Tag | null> {
  const doc = await getDb().get(id)
  return doc && isTagDoc(doc) ? doc : null
}

export async function listTags(): Promise<Tag[]> {
  const docs = await getDb().allDocs(ID_PREFIX.tag)
  return docs.filter(isTagDoc)
}

export async function createTag(input: { name: string; aliases?: string[]; id?: string }): Promise<Tag> {
  const doc: Tag = {
    // id 由调用方（tagNormalize）生成以处理 slug 冲突；缺省时用名称 slugify
    _id: input.id ?? `${ID_PREFIX.tag}${slugify(input.name)}`,
    name: input.name.trim(),
    aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
    createdAt: now(),
  }
  return putDoc(doc)
}

export async function updateTag(tag: Tag): Promise<Tag> {
  const doc = tag._rev ? tag : ((await getTag(tag._id)) ?? tag)
  return putDoc({ ...doc })
}

export async function deleteTag(id: string): Promise<void> {
  await removeById(id)
}

/** 名称 → slug（标签 _id 后缀；保留 Unicode 字母/数字，空格转连字符） */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
  return slug || 'tag'
}

// ---- 设置（来源类型枚举等） ----

export async function getSetting(key: string): Promise<Setting | null> {
  const doc = await getDb().get(`${ID_PREFIX.setting}${key}`)
  return doc && isSettingDoc(doc) ? doc : null
}

export async function saveSetting(key: string, value: unknown): Promise<Setting> {
  const existing = await getSetting(key)
  const doc: Setting = {
    _id: `${ID_PREFIX.setting}${key}`,
    _rev: existing?._rev,
    value,
    updatedAt: now(),
  }
  return putDoc(doc)
}

/** 来源类型枚举：无设置文档时返回内置默认（R4） */
export async function getSourceTypes(): Promise<SourceType[]> {
  const setting = await getSetting(SETTING_KEYS.sourceTypes)
  const value = setting?.value
  if (Array.isArray(value) && value.length > 0) {
    return value as SourceType[]
  }
  return [...BUILTIN_SOURCE_TYPES]
}

export async function saveSourceTypes(types: SourceType[]): Promise<Setting> {
  return saveSetting(SETTING_KEYS.sourceTypes, types)
}
