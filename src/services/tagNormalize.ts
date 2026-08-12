/**
 * services/tagNormalize.ts —— 标签规范化（别名归并）
 *
 * 契约（design.md 第 3 节、R14/R15）：
 * - 写入时输入文本 → 精确匹配 name/aliases（大小写不敏感）→ 归并到 canonical tagId
 * - 无匹配则新建标签；slug 由名称生成，冲突加后缀（-2、-3…）
 * - 联想补全（suggestTags）为模糊匹配 name + aliases，供 UI 下拉使用
 */
import { createTag, ID_PREFIX, listTags, slugify } from './db.ts'
import type { Tag } from '../types.ts'

/** 精确归并匹配：输入文本命中某标签的 name 或任一 aliases 则返回该标签 */
export function matchTag(text: string, tags: Tag[]): Tag | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  return (
    tags.find(
      (tag) =>
        tag.name.trim().toLowerCase() === t ||
        tag.aliases.some((a) => a.trim().toLowerCase() === t),
    ) ?? null
  )
}

/**
 * 编辑标签的别名冲突检测（阶段 6 定稿规则，R15）：
 * 新 name / 每个新 aliases（trim、大小写不敏感）若**精确命中其他标签**的 name 或 aliases，
 * 则冲突 → 保存被拒绝（UI 提示具体冲突值）。自身（tagId 相同）原有 name/aliases
 * 不构成冲突（编辑自身无意义冲突）。返回冲突标签列表。
 */
export function findTagConflicts(
  tagId: string,
  name: string,
  aliases: string[],
  allTags: Tag[],
): Tag[] {
  const others = allTags.filter((t) => t._id !== tagId)
  if (others.length === 0) return []
  const values = [name, ...aliases]
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
  return others.filter((t) => {
    const mine = [t.name, ...t.aliases].map((v) => v.trim().toLowerCase())
    return values.some((v) => mine.includes(v))
  })
}

/** 联想补全：模糊子串匹配 name + aliases（AC4：输入 "deep" 命中别名含 "deep learning" 的标签） */
export function suggestTags(text: string, tags: Tag[], limit = 8): Tag[] {
  const t = text.trim().toLowerCase()
  if (!t) return tags.slice(0, limit)
  return tags
    .filter(
      (tag) =>
        tag.name.toLowerCase().includes(t) ||
        tag.aliases.some((a) => a.toLowerCase().includes(t)),
    )
    .slice(0, limit)
}

/** 生成标签完整 _id（tag/<slug>），与现有标签冲突时追加 -2/-3… 后缀 */
export function buildTagId(name: string, existingTags: Tag[]): string {
  const base = slugify(name)
  const used = new Set(existingTags.map((t) => t._id))
  let id = `${ID_PREFIX.tag}${base}`
  let n = 2
  while (used.has(id)) {
    id = `${ID_PREFIX.tag}${base}-${n}`
    n += 1
  }
  return id
}

/** 单文本归并：命中返回既有标签，未命中新建并返回 */
export async function normalizeTag(
  input: string,
  existingTags?: Tag[],
): Promise<{ tag: Tag; created: boolean }> {
  const text = input.trim()
  if (!text) throw new Error('标签不能为空')
  const tags = existingTags ?? (await listTags())
  const matched = matchTag(text, tags)
  if (matched) return { tag: matched, created: false }
  const tag = await createTag({ id: buildTagId(text, tags), name: text })
  return { tag, created: true }
}

/**
 * 批量归并：输入文本列表 → canonical tagId 列表（去重）。
 * 注意：同一批内后出现的输入也能归并到本批刚创建的标签（tags 实时追加）。
 */
export async function normalizeTags(
  inputs: string[],
  existingTags?: Tag[],
): Promise<string[]> {
  const tags = [...(existingTags ?? (await listTags()))]
  const ids: string[] = []
  for (const raw of inputs) {
    const text = raw.trim()
    if (!text) continue
    const matched = matchTag(text, tags)
    const tag: Tag =
      matched ?? (await createTag({ id: buildTagId(text, tags), name: text }))
    if (tag !== matched) tags.push(tag)
    if (!ids.includes(tag._id)) ids.push(tag._id)
  }
  return ids
}
