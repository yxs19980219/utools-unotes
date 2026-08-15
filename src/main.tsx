import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { setThemePref } from './lib/theme.ts'
import { useNotesStore } from './stores/notes.ts'
import { useUiStore } from './stores/ui.ts'

/**
 * 明暗主题：首帧按系统（防闪白）；App bootstrap 加载 prefs 后按持久化偏好切换
 * （设置页可改为固定明/暗/跟随系统，见 lib/theme.ts）。
 */
setThemePref('system')

// 测试 hook（仅无 uTools 环境暴露）：ui-smoke/smoke-editor 用 window.__snDebug
// 触发搜索态 / 读取已落盘正文（round-trip 字节级断言）。uTools 内不注入。
if (typeof utools === 'undefined') {
  ;(window as unknown as { __snDebug?: { setSearch(query: string): void; getActiveNoteContent(): string } }).__snDebug = {
    setSearch: (query: string) => {
      const q = query.trim()
      useUiStore.getState().setSearch(q.length > 0, q)
    },
    getActiveNoteContent: () => {
      const id = useUiStore.getState().activeNoteId
      return id ? (useNotesStore.getState().getById(id)?.content ?? '') : ''
    },
  }
}

createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
