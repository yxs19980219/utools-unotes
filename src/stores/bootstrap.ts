/**
 * stores/bootstrap.ts —— 启动全量加载（design.md 第 4 节）
 *
 * 契约：一次 `allDocs` 全量载入内存，按类型守卫分区注入三个域。
 * 幂等：并发调用共享同一 in-flight promise；完成后再次调用会重新拉取
 * （uTools 重新进入插件 / HMR 场景可刷新外部同步的数据）。
 */
import { getDb, isNoteDoc, isObjectDoc, isTagDoc } from '../services/db.ts'
import { useNotesStore } from './notes.ts'
import { useObjectsStore } from './objects.ts'
import { useSettingsStore } from './settings.ts'
import { useTagsStore } from './tags.ts'
import { useUiStore } from './ui.ts'

let inflight: Promise<void> | null = null

/** 全量加载并注入三个域；幂等（in-flight 去重），返回完成信号 */
export function bootstrapStores(): Promise<void> {
  if (!inflight) {
    inflight = (async () => {
      try {
        const docs = await getDb().allDocs()
        // 类型守卫是 db.ts 层契约，此处只分区注入（跨层指南：不自行收窄）
        useObjectsStore.getState().hydrate(docs.filter(isObjectDoc))
        useNotesStore.getState().hydrate(docs.filter(isNoteDoc))
        useTagsStore.getState().hydrate(docs.filter(isTagDoc))
        // 设置域：来源类型枚举 + 偏好（R8 单一数据源 / R9 默认排序）
        await useSettingsStore.getState().load()
        // 偏好合并：启动时默认排序应用（relevance 仅搜索态，不覆盖）
        useUiStore.getState().applyPrefs(useSettingsStore.getState().prefs)
      } finally {
        inflight = null
      }
    })()
  }
  return inflight
}
