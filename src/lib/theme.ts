/**
 * lib/theme.ts —— 明暗主题应用（三态：light / dark / system）
 *
 * 单一入口 setThemePref：切换 html.dark 类驱动 shadcn token 体系。
 * - system：监听 prefers-color-scheme，系统变化即时跟随
 * - light/dark：直接设置，不再监听
 * 监听清理单例：重复调用先撤销旧监听，避免泄漏。
 * 约束：uTools CEF108 环境 matchMedia 可用；首帧调用 setThemePref('system') 防闪白。
 */
export type ThemePref = 'light' | 'dark' | 'system'

let cleanup: (() => void) | null = null

/** 单次应用主题，返回清理函数（system 时撤销 matchMedia 监听） */
export function applyThemePref(pref: ThemePref): () => void {
  // Node 冒烟环境（smoke-stores）无 window：安全跳过
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const dark = pref === 'dark' || (pref === 'system' && mq.matches)
    document.documentElement.classList.toggle('dark', dark)
  }
  apply()
  if (pref === 'system') {
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }
  return () => {}
}

/** 应用主题偏好（幂等；重复调用先撤销旧监听） */
export function setThemePref(pref: ThemePref): void {
  cleanup?.()
  cleanup = applyThemePref(pref)
}
