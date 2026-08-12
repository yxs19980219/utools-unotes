/**
 * components/ViewSwitcher.tsx —— 侧边栏顶部分段控件（R5，08-12 重构）
 *
 * [首页|标签|归档] 三视图均分侧边栏宽度（设置入口已移至底部齿轮 SidebarSettingsButton）。
 * - 侧边栏变浅（bg-sidebar #f7f7f8）后 TabsList 透明底，视图间浅灰竖线（Separator）分隔；
 *   悬停 hover:bg-accent、选中 bg-border（比悬停深）+ 加粗；dark 下悬停保持原 accent/60
 * - 路由切换直接调用（实时保存时代无确认）
 */
import { Fragment } from 'react'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUiStore, type View } from '@/stores/ui'

const VIEWS: { value: View; label: string }[] = [
  { value: 'home', label: '首页' },
  { value: 'tags', label: '标签' },
  { value: 'archived', label: '归档' },
]

export default function ViewSwitcher() {
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)

  return (
    <Tabs value={view} onValueChange={(v) => setView(v as View)} className="w-full gap-0">
      <TabsList className="w-full bg-transparent p-0">
        {VIEWS.map((v, i) => (
          <Fragment key={v.value}>
            {i > 0 && (
              <Separator orientation="vertical" className="h-4 w-px shrink-0 bg-foreground/20" />
            )}
            <TabsTrigger
              value={v.value}
              className="h-8 rounded-md px-1 text-[0.9rem] transition-colors hover:bg-accent data-[state=active]:bg-border! data-[state=active]:font-semibold data-[state=active]:shadow-none dark:hover:bg-accent/60"
            >
              {v.label}
            </TabsTrigger>
          </Fragment>
        ))}
      </TabsList>
    </Tabs>
  )
}
