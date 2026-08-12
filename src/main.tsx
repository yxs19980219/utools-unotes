import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

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

createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
