/**
 * 状态层冒烟测试（node 直测，无需 uTools 环境）
 * 运行：node scripts/smoke-stores.ts（npm run smoke:stores）
 * 覆盖：bootstrap 幂等 / 对象 CRUD 与钉住 / 归档自动取消钉住 /
 *       对象级联删除的内存同步 / 标签删除的引用清理（notes+objects）/ 标签计数
 */
import assert from 'node:assert/strict'
import { resetDbForTest } from '../src/services/db.ts'
import { bootstrapStores } from '../src/stores/bootstrap.ts'
import { useObjectsStore, selectPinnedObjects } from '../src/stores/objects.ts'
import { useNotesStore, selectNotesByObject } from '../src/stores/notes.ts'
import { useSettingsStore } from '../src/stores/settings.ts'
import { countNotesByTag, useTagsStore } from '../src/stores/tags.ts'
import { useUiStore } from '../src/stores/ui.ts'

let passed = 0
function ok(name: string) {
  passed += 1
  console.log(`  ✔ ${name}`)
}

async function main() {
  resetDbForTest() // 内存实现，隔离测试数据

  // ---- bootstrap：全量加载 + 幂等 ----
  console.log('[1] bootstrapStores')
  await bootstrapStores()
  assert.ok(useObjectsStore.getState().loaded)
  assert.ok(useNotesStore.getState().loaded)
  assert.ok(useTagsStore.getState().loaded)
  ok('首次加载完成')

  const object = await useObjectsStore.getState().create({
    title: '深度学习',
    sourceType: 'book',
    sourceMeta: { author: 'Ian Goodfellow', year: '2016' },
    tags: [],
  })
  const tagA = await useTagsStore.getState().create({ name: '深度学习', aliases: ['deep learning', 'DL'] })
  const tagB = await useTagsStore.getState().create({ name: '注意力' })

  // ---- 笔记 CRUD + AC10 校验 ----
  console.log('[2] 笔记创建与对象归属')
  await assert.rejects(
    useNotesStore.getState().create({
      objectId: 'object/not-exist',
      title: '无主笔记',
      content: '',
    }),
    /AC10/,
  )
  ok('未选对象时创建被拒（AC10 数据层兜底）')

  const note1 = await useNotesStore.getState().create({
    objectId: object._id,
    title: '注意力机制',
    content: 'Attention is all you need',
    tags: [tagA._id, tagB._id],
  })
  const note2 = await useNotesStore.getState().create({
    objectId: object._id,
    title: '反向传播',
    content: 'BP 算法',
    tags: [tagA._id],
  })
  const byObject = selectNotesByObject(useNotesStore.getState(), object._id)
  assert.equal(byObject.length, 2)
  ok('笔记挂载对象 + 按对象查询')

  // ---- 钉住 / 归档互斥（R12） ----
  console.log('[3] 钉住与归档')
  // 产品语义：新建对象默认钉住（创建即出现在首页，用户可取消）
  assert.equal(selectPinnedObjects(useObjectsStore.getState()).length, 1, '新建对象默认钉住')
  await useObjectsStore.getState().togglePinned(object._id)
  assert.equal(selectPinnedObjects(useObjectsStore.getState()).length, 0, '取消钉住')
  await useObjectsStore.getState().togglePinned(object._id)
  assert.equal(selectPinnedObjects(useObjectsStore.getState()).length, 1)
  ok('钉住对象出现在首页钉住列表')

  await useObjectsStore.getState().setArchived(object._id, true)
  const archived = useObjectsStore.getState().getById(object._id)
  assert.equal(archived?.archived, true)
  assert.equal(archived?.pinned, false, '归档应自动取消钉住')
  assert.equal(selectPinnedObjects(useObjectsStore.getState()).length, 0)
  ok('归档自动取消钉住（R12 互斥）')

  await useObjectsStore.getState().setArchived(object._id, false)

  // ---- 标签删除：跨域引用清理 ----
  console.log('[4] 标签删除的引用清理')
  await useTagsStore.getState().remove(tagB._id)
  assert.ok(!useTagsStore.getState().getById(tagB._id), '标签实体已删')
  const note1After = useNotesStore.getState().getById(note1._id)
  assert.ok(note1After && !note1After.tags.includes(tagB._id), '笔记引用已清理')
  ok('删标签后 notes.tags 清理（内存+db）')

  const objectWithTag = await useObjectsStore.getState().create({
    title: 'Attention 论文',
    sourceType: 'paper',
    tags: [tagA._id],
  })
  await useTagsStore.getState().remove(tagA._id)
  const objAfter = useObjectsStore.getState().getById(objectWithTag._id)
  assert.ok(objAfter && !objAfter.tags.includes(tagA._id), '对象引用已清理')
  const note2After = useNotesStore.getState().getById(note2._id)
  assert.ok(note2After && !note2After.tags.includes(tagA._id))
  ok('删标签后 objects/notes 引用全部清理')

  // ---- 标签计数（R8） ----
  console.log('[5] 标签计数')
  const tagC = await useTagsStore.getState().create({ name: '数学' })
  const other = await useObjectsStore.getState().create({ title: '另一本', sourceType: 'book' })
  await useNotesStore.getState().create({
    objectId: other._id,
    title: '导数',
    content: '',
    tags: [tagC._id],
  })
  await useNotesStore.getState().create({
    objectId: other._id,
    title: '矩阵',
    content: '',
    tags: [tagC._id],
  })
  const counts = countNotesByTag(
    useTagsStore.getState().tags,
    useNotesStore.getState().notes,
  )
  assert.equal(counts.get(tagC._id), 2)
  ok('标签笔记计数正确')

  // ---- 对象删除：级联 + 内存同步 ----
  console.log('[6] 对象级联删除')
  const before = useNotesStore.getState().notes.length
  const removed = await useObjectsStore.getState().remove(other._id)
  assert.equal(removed, 2)
  assert.equal(useNotesStore.getState().notes.length, before - 2)
  assert.ok(!useObjectsStore.getState().getById(other._id))
  ok('删除对象级联清理笔记（db + 内存）')

  // ---- ui store ----
  console.log('[7] ui store')
  useUiStore.getState().selectObject(object._id)
  assert.equal(useUiStore.getState().selectedObjectId, object._id)
  useUiStore.getState().selectTag(tagC._id)
  assert.equal(useUiStore.getState().selectedObjectId, null, '选标签清除对象选中')
  useUiStore.getState().setView('tags')
  assert.equal(useUiStore.getState().selectedTagId, null, '切视图清空选中')
  useUiStore.getState().startEditing('note', null)
  assert.deepEqual(useUiStore.getState().editing, { kind: 'note', id: null })
  useUiStore.getState().stopEditing()
  assert.equal(useUiStore.getState().editing, null)
  ok('视图切换/选中互斥/编辑态')

  // ---- 阶段 4：resolveTagIds（表单标签写入入口，R15 归并） ----
  console.log('[8] resolveTagIds 归并')
  const mergeTag = await useTagsStore.getState().create({
    name: '归并测试',
    aliases: ['merge-test'],
  })
  const resolved = await useTagsStore.getState().resolveTagIds([
    '归并测试',
    'merge-test',
    '全新标签',
  ])
  assert.equal(resolved[0], mergeTag._id, '规范名归并到既有标签')
  assert.equal(resolved.length, 2, '别名归并去重（merge-test 不产生新 id）+ 新建')
  assert.equal(resolved[1], 'tag/全新标签')
  assert.equal(useTagsStore.getState().getById(resolved[1])?.name, '全新标签')
  ok('标签文本 → canonical tagId 去重归并')

  // ---- 阶段 4：排序 / 来源筛选（R17，ContentHeader → NoteCardList 联动） ----
  console.log('[9] 排序与来源筛选')
  assert.equal(useUiStore.getState().sort, 'updated')
  useUiStore.getState().setSort('title')
  assert.equal(useUiStore.getState().sort, 'title')
  useUiStore.getState().setSourceFilter('book')
  assert.equal(useUiStore.getState().sourceFilter, 'book')
  // 切视图不清空用户偏好（跨视图保留）
  useUiStore.getState().setView('tags')
  assert.equal(useUiStore.getState().sort, 'title')
  assert.equal(useUiStore.getState().sourceFilter, 'book')
  ok('排序/筛选状态持久')

  // ---- 阶段 7：搜索态排序语义（setSearch 进入/退出迁移） ----
  console.log('[10] 搜索态（setSearch 排序迁移）')
  useUiStore.getState().setSort('created')
  useUiStore.getState().setSearch(true, '注意力')
  assert.equal(useUiStore.getState().search.active, true)
  assert.equal(useUiStore.getState().search.query, '注意力')
  assert.equal(useUiStore.getState().sort, 'relevance', '进入搜索态默认相关度')
  useUiStore.getState().setSearch(true, '注意力 机制')
  assert.equal(useUiStore.getState().sort, 'relevance', '搜索态内输入不重置排序选择')
  useUiStore.getState().setSort('title')
  useUiStore.getState().setSearch(false, '')
  assert.equal(useUiStore.getState().search.active, false)
  assert.equal(useUiStore.getState().sort, 'created', '退出搜索恢复浏览态排序')
  useUiStore.getState().setSearch(true, 'x')
  useUiStore.getState().selectObject(object._id)
  assert.equal(useUiStore.getState().search.active, false, '选中对象退出搜索态')
  ok('搜索态进入/退出排序迁移 + 选中退出搜索')

  // ---- 二期：设置域（来源类型枚举 + 偏好，R7/R8/R9） ----
  console.log('[11] 设置域：来源类型枚举 + 偏好')
  assert.equal(useSettingsStore.getState().loaded, true, 'bootstrap 已加载设置域')
  assert.equal(useSettingsStore.getState().sourceTypes.length, 6, '默认内置 6 种')

  // 新增（去重校验 + 自定义 id 生成）
  const podcast = await useSettingsStore.getState().addSourceType('播客')
  assert.equal(podcast.builtin, false)
  assert.equal(useSettingsStore.getState().sourceTypes.length, 7)
  await assert.rejects(
    useSettingsStore.getState().addSourceType('播客'),
    /已存在/,
    '同名去重拒绝',
  )
  // id 冲突后缀（label 不同但 slugify 撞内置 id）
  const book2 = await useSettingsStore.getState().addSourceType('Book')
  assert.notEqual(book2.id, 'book', 'slug 撞内置 id 时追加后缀')
  ok('枚举新增 + 精确去重 + id 冲突后缀')

  // 重命名（自定义可改，内置锁定）
  await useSettingsStore.getState().renameSourceType(podcast.id, '播客频道')
  assert.equal(useSettingsStore.getState().getById(podcast.id)?.label, '播客频道')
  await assert.rejects(
    useSettingsStore.getState().renameSourceType('book', '改名内置'),
    /内置类型不可改名/,
  )
  ok('重命名：自定义可改 / 内置锁定')

  // 引用计数 + 强制删除（AC5）
  await useObjectsStore.getState().create({
    title: '播客引用对象',
    sourceType: podcast.id,
  })
  assert.equal(await useSettingsStore.getState().countReferences(podcast.id), 1)
  await useSettingsStore.getState().removeSourceType(podcast.id)
  assert.ok(!useSettingsStore.getState().getById(podcast.id), '枚举已删')
  // 被引用对象保留原类型字符串（删除后筛选器不再出现，对象字段不受影响）
  assert.equal(useObjectsStore.getState().objects.some((o) => o.sourceType === podcast.id), true)
  await assert.rejects(
    useSettingsStore.getState().removeSourceType('book'),
    /内置类型不可删除/,
  )
  ok('删除：引用计数 + 强制删除保留对象字段 / 内置锁定')

  // 偏好（R9）：savePrefs + applyPrefs（relevance 不覆盖）
  await useSettingsStore.getState().savePrefs({ defaultSort: 'created' })
  assert.equal(useSettingsStore.getState().prefs.defaultSort, 'created')
  useUiStore.getState().setSort('updated')
  useUiStore.getState().applyPrefs({ defaultSort: 'created' })
  assert.equal(useUiStore.getState().sort, 'created', '偏好应用默认排序')
  useUiStore.getState().setSearch(true, 'x')
  useUiStore.getState().applyPrefs({ defaultSort: 'title' })
  assert.equal(useUiStore.getState().sort, 'relevance', '搜索态不被偏好覆盖')
  useUiStore.getState().setSearch(false, '')
  assert.equal(useUiStore.getState().preSearchSort, 'title', '退出搜索恢复偏好排序')
  ok('偏好：默认排序保存 + 应用（搜索态不覆盖）')

  // ---- 二期：草稿拦截（R11/R12 requestRoute/discardDirty） ----
  console.log('[12] 草稿拦截（requestRoute / discardDirty）')
  assert.equal(useUiStore.getState().pendingDirty, false)
  useUiStore.getState().setPendingDirty(true, () => 'discarded')
  // 路由请求被暂存，不立即执行
  let executed = false
  useUiStore.getState().requestRoute(() => {
    executed = true
  })
  assert.equal(executed, false, 'pendingDirty 时路由请求被拦截')
  assert.ok(useUiStore.getState().dirtyRoute !== null, '请求暂存到 dirtyRoute')
  // 取消：留在原处，请求未执行
  useUiStore.getState().cancelRoute()
  assert.equal(executed, false)
  assert.equal(useUiStore.getState().dirtyRoute, null)
  // 放弃：执行 onDiscard + 暂存请求
  useUiStore.getState().requestRoute(() => {
    executed = true
  })
  useUiStore.getState().discardDirty()
  assert.equal(executed, true, '放弃后执行暂存请求')
  assert.equal(useUiStore.getState().pendingDirty, false)
  assert.equal(useUiStore.getState().dirtyRoute, null)
  // 无 dirty 时直接执行
  executed = false
  useUiStore.getState().requestRoute(() => {
    executed = true
  })
  assert.equal(executed, true, '无 dirty 时请求直接执行')
  ok('草稿拦截：拦截/取消/放弃/直通')

  console.log(`\n✅ stores 冒烟通过（${passed} 项断言）`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
