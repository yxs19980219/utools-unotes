/**
 * lib/format.ts —— 展示层时间格式化（统一入口，禁止各组件自行 toLocaleString）
 *
 * 规则（紧凑密度）：当天显示 HH:mm，同年显示 M月d日，跨年显示 yyyy/M/d。
 */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
