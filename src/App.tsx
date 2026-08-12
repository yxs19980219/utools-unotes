import { useEffect, useRef } from 'react'

import ContentArea from '@/components/ContentArea'
import ContentHeader from '@/components/ContentHeader'
import DirtyGuard from '@/components/DirtyGuard'
import SidebarList from '@/components/SidebarList'
import ViewSwitcher from '@/components/ViewSwitcher'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { bootstrapStores } from '@/stores/bootstrap'
import { useUiStore } from '@/stores/ui'

/**
 * App —— 两栏布局骨架（design.md 第 6 节）：
 *
 * ┌──────────────┬──────────────────────────┐
 * │ ViewSwitcher │  ContentHeader（标题行）   │
 * │ SidebarList  ├──────────────────────────┤
 * │  (190px)     │  ContentArea（路由）      │
 * └──────────────┴──────────────────────────┘
 *
 * - 800×600 紧凑密度：侧边栏 w-48、header h-11、内容区 min-w-0 防横向滚动
 * - 启动时一次全量加载三个域（bootstrapStores，幂等）
 */
export default function App() {
  // 子输入框防抖计时器（阶段 7：避免每次击键全量过滤）
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    void bootstrapStores()
    // uTools 入口（插件功能路由；多 feature 时按 action.code 分发）
    if (typeof utools !== 'undefined') {
      utools.onPluginEnter(({ code }) => {
        console.log('[sourcenote] entered, feature code =', code)
      })
      // 阶段 7：子输入框全文搜索（R16/AC6）。进入插件即注册，uTools 搜索条变为子输入框；
      // 输入防抖 200ms 后写入 ui store（search 态，见 setSearch 排序迁移语义）；
      // 输入清空退出搜索态回到原视图。placeholder 提示搜索语法。
      utools.setSubInput(
        ({ text }: { text: string }) => {
          if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
          debounceRef.current = window.setTimeout(() => {
            debounceRef.current = null
            const q = text.trim()
            useUiStore.getState().setSearch(q.length > 0, q)
          }, 200)
        },
        '搜索：type:book 关键词 #标签',
      )
    }
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen min-w-0 overflow-hidden bg-background">
      {/* 左侧边栏 */}
      <aside className="flex w-48 shrink-0 flex-col border-r border-border">
        <div className="p-2 pb-1.5">
          <ViewSwitcher />
        </div>
        <SidebarList />
      </aside>

      {/* 右侧内容区 */}
      <main className="flex min-w-0 flex-1 flex-col">
        <ContentHeader />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ContentArea />
        </div>
      </main>

      <Toaster />
      <DirtyGuard />
      </div>
    </TooltipProvider>
  )
}
