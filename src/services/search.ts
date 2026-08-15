/**
 * services/search.ts —— 语法解析 + 内存全文搜索（design.md 第 4 节）
 *
 * 语法（自研轻量 tokenizer）：
 *   #x        标签匹配（name 或 aliases 模糊子串）
 *   裸词      标题/标签/正文全文子串匹配（小写化）
 *   （可组合，空格分隔，全部为 AND 语义）
 *
 * 排序：默认相关度降序（标题命中 > 标签命中 > 正文命中，词频加分），
 * 同分按最近更新倒序。归档笔记同样可命中（AC9，只读由 UI 层处理）。
 *
 * 纯内存过滤，不写任何索引到 db（红线）。
 */
import type { Note, NoteObject, SearchSort, Tag } from '../types.ts'

/** 搜索上下文：启动时全量载入内存的 notes/objects/tags */
export interface SearchContext {
  notes: Note[]
  objects: NoteObject[]
  tags: Tag[]
}

export interface SearchResult {
  note: Note
  object: NoteObject | null
  /** 命中的 tagId（标签过滤与关键词标签命中累计） */
  tagMatches: string[]
  /** 相关度分：0 = 无关键词（仅过滤） */
  score: number
}

export interface SearchTokens {
  tagTexts: string[]
  keywords: string[]
}

/** 语法解析（纯函数，可单测） */
export function tokenize(query: string): SearchTokens {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  const out: SearchTokens = { tagTexts: [], keywords: [] }
  for (const tok of tokens) {
    if (tok.startsWith('#')) {
      out.tagTexts.push(tok.slice(1).toLowerCase())
    } else {
      out.keywords.push(tok.toLowerCase())
    }
  }
  return out
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

function matchesTagText(tag: Tag, text: string): boolean {
  return (
    tag.name.toLowerCase().includes(text) ||
    tag.aliases.some((a) => a.toLowerCase().includes(text))
  )
}

/** 全文搜索：tokenizer + 内存过滤 + 相关度排序 */
export function searchNotes(query: string, ctx: SearchContext): SearchResult[] {
  const tokens = tokenize(query)
  if (tokens.tagTexts.length === 0 && tokens.keywords.length === 0) {
    return []
  }

  const objectById = new Map(ctx.objects.map((o) => [o._id, o]))
  const tagById = new Map(ctx.tags.map((t) => [t._id, t]))

  const results: SearchResult[] = []
  for (const note of ctx.notes) {
    const object = objectById.get(note.objectId) ?? null

    // #x —— 每个标签词须命中 note 的某个标签（name/aliases 模糊），AND
    const tagMatches = new Set<string>()
    if (tokens.tagTexts.length > 0) {
      const hitAll = tokens.tagTexts.every((tt) => {
        for (const tagId of note.tags) {
          const tag = tagById.get(tagId)
          if (tag && matchesTagText(tag, tt)) {
            tagMatches.add(tagId)
            return true
          }
        }
        return false
      })
      if (!hitAll) continue
    }

    // 裸词 —— 标题/标签/正文，AND；相关度：标题 10× 词频、标签 6、正文 2× 词频（封顶 5）
    let score = 0
    if (tokens.keywords.length > 0) {
      const title = note.title.toLowerCase()
      const content = note.content.toLowerCase()
      let allHit = true
      for (const kw of tokens.keywords) {
        let s = 0
        if (title.includes(kw)) s += 10 * countOccurrences(title, kw)
        let tagHit = false
        for (const tagId of note.tags) {
          const tag = tagById.get(tagId)
          if (tag && matchesTagText(tag, kw)) {
            tagHit = true
            tagMatches.add(tagId)
          }
        }
        if (tagHit) s += 6
        if (content.includes(kw)) s += 2 * Math.min(countOccurrences(content, kw), 5)
        if (s === 0) {
          allHit = false
          break
        }
        score += s
      }
      if (!allHit) continue
    }

    results.push({ note, object, tagMatches: [...tagMatches], score })
  }

  // 相关度降序，同分按最近更新倒序
  results.sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt)
  return results
}

/** 浏览态排序（R17 排序菜单；relevance 仅搜索场景使用，浏览态退化按最近更新） */
export function sortNotes(notes: Note[], sort: SearchSort): Note[] {
  const sorted = [...notes]
  switch (sort) {
    case 'title':
      return sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    case 'created':
      return sorted.sort((a, b) => b.createdAt - a.createdAt)
    case 'relevance':
    case 'updated':
    default:
      return sorted.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
