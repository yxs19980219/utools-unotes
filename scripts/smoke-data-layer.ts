/**
 * 数据层冒烟测试（node 直测，无需 uTools 环境）
 * 运行：node scripts/smoke-data-layer.ts
 * 覆盖：schema 读写往返 / _rev 冲突 / 级联删除 / 标签别名归并 / 搜索语法
 */
import assert from 'node:assert/strict'
import {
  createNote,
  createObject,
  createTag,
  deleteObjectCascade,
  getDb,
  getNote,
  getObject,
  listNotes,
  listObjects,
  listTags,
  resetDbForTest,
  updateNote,
  updateObject,
} from '../src/services/db.ts'
import {
  findTagConflicts,
  matchTag,
  normalizeTags,
  suggestTags,
} from '../src/services/tagNormalize.ts'
import { searchNotes, tokenize, sortNotes } from '../src/services/search.ts'

let passed = 0
function ok(name: string) {
  passed += 1
  console.log(`  ✔ ${name}`)
}

async function main() {
  resetDbForTest() // 内存实现，隔离测试数据

  // ---- schema 读写往返 ----
  console.log('[1] db 读写往返')
  const obj = await createObject({
    title: '深度学习',
    sourceType: 'book',
    sourceMeta: { author: 'Ian Goodfellow', year: '2016' },
  })
  assert.ok(obj._id.startsWith('object/'), '对象 _id 前缀')
  assert.equal(obj.pinned, false)
  assert.equal(obj.archived, false)
  assert.ok(obj._rev, '新建后应带 _rev')
  ok('createObject 往返')

  const note = await createNote({
    objectId: obj._id,
    title: '注意力机制',
    content: 'Attention is all you need。注意力缩放：q·k / sqrt(dk)',
  })
  assert.ok(note._id.startsWith('note/'), '笔记 _id 前缀')
  const got = await getNote(note._id)
  assert.equal(got?.title, '注意力机制')
  ok('createNote + getNote 往返')

  // 更新必须带 _rev；缺 _rev 的 updateObject 容错补读
  const updated = await updateNote({ ...note, title: '注意力机制（修订）' })
  assert.ok(updated._rev !== note._rev, '更新后 rev 变化')
  const got2 = await getNote(note._id)
  assert.equal(got2?.title, '注意力机制（修订）')
  ok('updateNote 带 _rev 生效')

  // 缺 _rev 直接 put 应失败（MemoryDb 对齐真实 API）
  const bad = await getDb().put({ _id: obj._id, title: 'x' } as never)
  assert.equal(bad.error, true, '缺 _rev 更新应冲突')
  assert.equal(bad.name, 'conflict')
  ok('缺 _rev 更新冲突检测')

  const notes = await listNotes()
  assert.equal(notes.length, 1)
  assert.equal((await listObjects()).length, 1)
  ok('listNotes/listObjects 前缀查询')

  // 对象删除级联：建 2 条笔记 → 级联删除返回数量且库中清空
  await createNote({ objectId: obj._id, title: 'n2', content: '' })
  await createNote({ objectId: obj._id, title: 'n3', content: '' })
  const deleted = await deleteObjectCascade(obj._id)
  assert.equal(deleted, 3)
  assert.equal(await getObject(obj._id), null)
  assert.equal((await listNotes()).length, 0)
  ok('deleteObjectCascade 级联删除 3 条')

  // ---- 标签规范化 ----
  console.log('[2] 标签别名归并')
  const obj2 = await createObject({ title: '对象2', sourceType: 'course' })
  await createNote({ objectId: obj2._id, title: 't1', content: '', tags: [] })

  // 别名归并（R15）：别名先存在于标签实体，后续输入经别名归并到同一标签
  await createTag({ name: '深度学习', aliases: ['deep learning', 'DL'] })
  const ids1 = await normalizeTags(['深度学习', 'deep learning', 'DL'])
  assert.equal(ids1.length, 1, '别名应归并到同一标签')
  const tagId = ids1[0]
  const tag = (await listTags()).find((t) => t._id === tagId)
  assert.equal(tag?.name, '深度学习')
  assert.equal(matchTag('DEEP LEARNING', [tag!])?._id, tagId, '大小写不敏感')
  ok(`别名归并 → ${tag?.name} (${tag?._id})`)

  const sugg = suggestTags('deep', [tag!])
  assert.equal(sugg[0]?._id, tagId, '输入 deep 命中别名含 deep learning 的标签')
  ok('suggestTags 联想命中别名（AC4 语义）')

  const ids2 = await normalizeTags(['深度学习', '深度'], [tag!])
  assert.equal(ids2.length, 2, '规范名 + 新标签')
  const tags = await listTags()
  const slugCollision = await normalizeTags(['深度学习'], tags) // 已存在 → 归并不新建
  assert.equal(slugCollision[0], tagId)
  ok('重复输入归并不新建')

  // 阶段 6：编辑标签的别名冲突归并规则（定稿）——新 name/aliases 精确命中其他标签则拒绝
  const conflictTag = await createTag({ name: '注意力', aliases: ['attention'] })
  const allTags = await listTags()
  const clash1 = findTagConflicts(tagId, '深度学习', ['attention'], allTags)
  assert.equal(clash1[0]?._id, conflictTag._id, '别名 attention 已属于「注意力」→ 冲突')
  const clash2 = findTagConflicts(tagId, '注意力', [], allTags)
  assert.equal(clash2[0]?._id, conflictTag._id, '规范名被其他标签占用 → 冲突')
  const clash3 = findTagConflicts(tagId, '注意力', [], allTags)
  assert.equal(clash3.length, 1, '别名编辑命中其他标签 name 同样冲突')
  const noClash = findTagConflicts(tagId, '深度学习', ['deep-learning'], allTags)
  assert.equal(noClash.length, 0, '自身原有 name/别名不构成冲突，无主别名通过')
  ok('findTagConflicts 别名冲突检测（阶段 6 定稿规则）')

  // ---- 搜索 ----
  console.log('[3] 搜索语法')
  const objB = await createObject({ title: 'Attention Book', sourceType: 'book' })
  const objV = await createObject({ title: 'AI 视频', sourceType: 'video' })
  await createNote({
    objectId: objB._id,
    title: '注意力与变压器',
    content: '注意力机制让模型关注关键信息',
    tags: [tagId],
  })
  await createNote({
    objectId: objB._id,
    title: '另一本书记录',
    content: '无关内容',
    tags: [],
  })
  await createNote({ objectId: objV._id, title: '视频笔记', content: '注意力集中练习', tags: [] })

  const ctx = { notes: await listNotes(), objects: await listObjects(), tags: await listTags() }

  assert.deepEqual(tokenize('注意力 #深度学习'), {
    tagTexts: ['深度学习'],
    keywords: ['注意力'],
  })
  ok('tokenize 组合语法')

  const r1 = searchNotes('注意力', ctx)
  assert.equal(r1.length, 2, '裸词命中 book 与 video 各 1 条')
  const bookHit = r1.find((r) => r.object?.sourceType === 'book')
  const videoHit = r1.find((r) => r.object?.sourceType === 'video')
  assert.ok(bookHit && videoHit, '跨来源命中')
  assert.ok(bookHit!.score > videoHit!.score, '标题命中 > 正文命中')
  ok('裸词跨对象命中 + 相关度排序')

  const r3 = searchNotes('#深度学习', ctx)
  assert.equal(r3.length, 1, '标签过滤命中 1 条')
  assert.ok(r3[0].tagMatches.includes(tagId), 'tagMatches 携带命中 tagId')
  ok('#深度学习 标签过滤')

  const r5 = searchNotes('#不存在的标签', ctx)
  assert.equal(r5.length, 0)
  ok('不存在的标签过滤为空')

  const r6 = searchNotes('', ctx)
  assert.equal(r6.length, 0, '空查询无结果')
  ok('空查询')

  // AC9（R13）：归档是状态不是隔离区——归档对象的笔记仍可被全文搜索命中，
  // 结果携带归档对象（UI 据此渲染只读态）
  const archivedObj = await createObject({ title: '已归档书籍', sourceType: 'book' })
  await createNote({
    objectId: archivedObj._id,
    title: '归档后的笔记',
    content: 'Zettelkasten 卡片盒方法',
    tags: [],
  })
  await updateObject({ ...archivedObj, archived: true })
  const ctxArchived = {
    notes: await listNotes(),
    objects: await listObjects(),
    tags: await listTags(),
  }
  const rArchived = searchNotes('Zettelkasten', ctxArchived)
  assert.equal(rArchived.length, 1, '归档对象的笔记仍命中全文搜索')
  assert.equal(rArchived[0].object?.archived, true, '结果携带归档对象（UI 据此只读渲染）')
  ok('归档笔记可被搜索命中（AC9 语义）')

  // 浏览态排序
  const sorted = sortNotes(ctx.notes, 'title')
  assert.equal(sorted[0].title, '另一本书记录') // 中文 localeCompare
  const byUpdated = sortNotes(ctx.notes, 'updated')
  const times = byUpdated.map((n) => n.updatedAt)
  assert.ok(
    times.every((t, i) => i === 0 || times[i - 1] >= t),
    'updated 排序应按 updatedAt 非递增',
  )
  ok('sortNotes title/updated')

  console.log(`\n全部通过：${passed} 项断言`)
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err)
  process.exit(1)
})
