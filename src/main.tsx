import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useUiStore } from './stores/ui.ts'

/**
 * 暗色模式：uTools 主题跟随系统，优先用 web 原生 prefers-color-scheme
 * （utools-dev skill 推荐），切换 html 的 .dark 类驱动 shadcn token 体系。
 */
function applyTheme() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)
}
applyTheme()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

// 测试 hook（仅无 uTools 环境暴露）：ui-smoke 用 window.__snDebug.setSearch 触发搜索态
//（uTools 内搜索走原生子输入框 setSubInput，不注入）
if (typeof utools === 'undefined') {
  ;(window as unknown as { __snDebug?: { setSearch(query: string): void } }).__snDebug = {
    setSearch: (query: string) => {
      const q = query.trim()
      useUiStore.getState().setSearch(q.length > 0, q)
    },
  }
}

createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
